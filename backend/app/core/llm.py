import json
import time
import uuid
from contextvars import ContextVar
from typing import Any, Optional

import structlog
import httpx
from anthropic import AsyncAnthropic
from app.config import settings

logger = structlog.get_logger(__name__)

# Per-task contextvars set by the worker so every chat_completion under a
# given LangGraph node automatically gets tagged with the right campaign /
# agent. Avoids threading campaign_id through every agent's call site.
current_campaign_id: ContextVar[Optional[str]] = ContextVar("current_campaign_id", default=None)
current_agent_type: ContextVar[Optional[str]] = ContextVar("current_agent_type", default=None)


# Per-1M-token USD pricing. Lookup falls through provider-default ('*') if
# the model isn't listed. Numbers are rough vendor list prices and should be
# updated as terms change; consumers can also pass `cost_per_1m=(in,out)` to
# `estimate_cost` to override.
PRICING_PER_1M: dict[tuple[str, str], tuple[float, float]] = {
    ("anthropic", "claude-3-5-sonnet"):       (3.00, 15.00),
    ("anthropic", "claude-3-5-haiku"):        (0.80, 4.00),
    ("anthropic", "claude-3-opus"):           (15.00, 75.00),
    ("anthropic", "*"):                       (3.00, 15.00),
    ("deepseek",  "deepseek-chat"):           (0.14, 0.28),
    ("deepseek",  "deepseek-reasoner"):       (0.55, 2.19),
    ("deepseek",  "*"):                       (0.14, 0.28),
    ("gemini",    "*"):                       (0.10, 0.40),
    ("qwen",      "*"):                       (0.40, 1.20),
    ("zhipu",     "*"):                       (0.30, 0.90),
}


def estimate_cost_usd(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate USD cost for a single call. Falls back to provider default."""
    key_specific = (provider, model)
    key_default  = (provider, "*")
    rates = PRICING_PER_1M.get(key_specific) or PRICING_PER_1M.get(key_default) or (0.0, 0.0)
    in_rate, out_rate = rates
    return (input_tokens / 1_000_000.0) * in_rate + (output_tokens / 1_000_000.0) * out_rate


async def _record_usage(
    provider: str, model: str, input_tokens: int, output_tokens: int, latency_ms: int
) -> None:
    """Persist one usage row tagged with the current campaign (if any).

    Best-effort: any DB error is logged and swallowed so a usage write
    failure never breaks the actual LLM call.
    """
    cid = current_campaign_id.get()
    if not cid:
        return  # not running inside a worker job — skip persistence
    try:
        # Local import to avoid circular deps at module load time.
        from app.database import async_session_factory
        from app.models.usage import LLMUsage

        try:
            cid_uuid = uuid.UUID(cid)
        except (ValueError, TypeError):
            return

        async with async_session_factory() as db:
            db.add(LLMUsage(
                campaign_id=cid_uuid,
                provider=provider[:40],
                model=(model or "")[:100],
                input_tokens=int(input_tokens or 0),
                output_tokens=int(output_tokens or 0),
                latency_ms=latency_ms,
                agent_type=(current_agent_type.get() or None),
            ))
            await db.commit()
    except Exception as exc:
        logger.warning("llm_usage_persist_failed", error=str(exc))


class LLMClient:
    """
    Generic LLM client supporting multiple providers.
    Initially supports Anthropic, with placeholders for others.
    """
    def __init__(self):
        self.anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else None

    async def chat_completion(
        self,
        messages: list[dict],
        system: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None
    ) -> str:
        """
        Run a chat completion against the preferred provider chain.

        If `provider` is explicit, that provider is used as-is (no fallback —
        the caller asked for it specifically). Otherwise, walks the configured
        chain `gemini → deepseek → qwen → zhipu → anthropic`, skipping
        providers without keys, and falls through to the next on any failure
        (auth, quota, geo-block, timeout, etc.). Raises only if every
        configured provider fails.
        """
        if provider:
            return await self._call_provider(provider, messages, system, model, max_tokens)

        chain = []
        if settings.gemini_api_key:    chain.append("gemini")
        if settings.deepseek_api_key:  chain.append("deepseek")
        if settings.qwen_api_key:      chain.append("qwen")
        if settings.zhipu_api_key:     chain.append("zhipu")
        if settings.anthropic_api_key: chain.append("anthropic")
        if not chain:
            raise ValueError("No LLM provider configured")

        last_error: Optional[Exception] = None
        for idx, prov in enumerate(chain):
            try:
                result = await self._call_provider(prov, messages, system, model, max_tokens)
                if idx > 0:
                    logger.warning(
                        "llm_fallback_succeeded",
                        used=prov,
                        skipped=chain[:idx],
                    )
                return result
            except Exception as exc:
                # Catch-all is intentional: any failure from a provider
                # (HTTP 4xx/5xx, timeouts, SDK errors, JSON shape errors)
                # should let the next provider try. Programming bugs here
                # will still surface — they re-raise after the chain ends.
                logger.warning(
                    "llm_provider_failed",
                    provider=prov,
                    error_type=type(exc).__name__,
                    error=str(exc)[:300],
                )
                last_error = exc

        raise RuntimeError(
            f"All LLM providers failed ({chain}). Last error: {last_error}"
        ) from last_error

    async def _call_provider(self, provider, messages, system, model, max_tokens):
        if provider == "anthropic":
            return await self._anthropic_completion(messages, system, model, max_tokens)
        elif provider == "deepseek":
            return await self._openai_compatible_completion(
                "https://api.deepseek.com/v1",
                settings.deepseek_api_key,
                messages,
                system,
                model or settings.deepseek_model,
                max_tokens,
                provider_name="deepseek",
            )
        elif provider == "qwen":
            return await self._openai_compatible_completion(
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
                settings.qwen_api_key,
                messages,
                system,
                model or settings.qwen_model,
                max_tokens,
                provider_name="qwen",
            )
        elif provider == "zhipu":
            return await self._openai_compatible_completion(
                "https://open.bigmodel.cn/api/paas/v4",
                settings.zhipu_api_key,
                messages,
                system,
                model or settings.zhipu_model,
                max_tokens,
                provider_name="zhipu",
            )
        elif provider == "gemini":
            return await self._openai_compatible_completion(
                "https://generativelanguage.googleapis.com/v1beta/openai",
                settings.gemini_api_key,
                messages,
                system,
                model or settings.gemini_model,
                max_tokens,
                provider_name="gemini",
            )
        else:
            raise ValueError(f"Unsupported provider: {provider}")

    async def _anthropic_completion(self, messages, system, model, max_tokens):
        resolved_model = model or settings.anthropic_model
        logger.info("llm_request", provider="anthropic", model=resolved_model,
                    system=system, messages=messages)
        t0 = time.monotonic()
        response = await self.anthropic.messages.create(
            model=resolved_model,
            max_tokens=max_tokens or settings.anthropic_max_tokens,
            system=system,
            messages=messages,
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        result = response.content[0].text

        # Anthropic SDK exposes usage as response.usage.{input_tokens, output_tokens}
        usage = getattr(response, "usage", None)
        in_tok  = int(getattr(usage, "input_tokens",  0) or 0)
        out_tok = int(getattr(usage, "output_tokens", 0) or 0)
        await _record_usage("anthropic", resolved_model, in_tok, out_tok, latency_ms)

        logger.info("llm_response", provider="anthropic", model=resolved_model,
                    response=result, input_tokens=in_tok, output_tokens=out_tok)
        return result

    async def _openai_compatible_completion(
        self, base_url, api_key, messages, system, model, max_tokens, provider_name=None
    ):
        # NOTE: Timeout must be 180s for long technical articles
        async with httpx.AsyncClient(timeout=180.0) as client:
            full_messages = []
            if system:
                full_messages.append({"role": "system", "content": system})
            full_messages.extend(messages)

            payload = {
                "model": model,
                "messages": full_messages,
                "max_tokens": max_tokens or 4096,
            }

            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            url = base_url
            if "/chat/completions" not in url:
                if "?" in url:
                    url = url.replace("?", "/chat/completions?", 1)
                else:
                    url = url.rstrip("/") + "/chat/completions"

            host = url.split("/")[2]
            prov = provider_name or host
            logger.info("llm_request", provider=host, model=model,
                        messages=full_messages)
            t0 = time.monotonic()
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            latency_ms = int((time.monotonic() - t0) * 1000)
            data = response.json()
            result = data["choices"][0]["message"]["content"]

            usage = data.get("usage") or {}
            in_tok  = int(usage.get("prompt_tokens")     or usage.get("input_tokens")  or 0)
            out_tok = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
            await _record_usage(prov, model, in_tok, out_tok, latency_ms)

            logger.info("llm_response", provider=host, model=model,
                        response=result, input_tokens=in_tok, output_tokens=out_tok)
            return result

llm_client = LLMClient()
