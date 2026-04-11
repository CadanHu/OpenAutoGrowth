import json
from typing import Any, Optional
import structlog
import httpx
from anthropic import AsyncAnthropic
from app.config import settings

logger = structlog.get_logger(__name__)

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
        # Determine provider
        if not provider:
            if settings.anthropic_api_key:
                provider = "anthropic"
            elif settings.deepseek_api_key:
                provider = "deepseek"
            elif settings.qwen_api_key:
                provider = "qwen"
            elif settings.gemini_api_key:
                provider = "gemini"
            elif settings.zhipu_api_key:
                provider = "zhipu"
            else:
                raise ValueError("No LLM provider configured")

        if provider == "anthropic":
            return await self._anthropic_completion(messages, system, model, max_tokens)
        elif provider == "deepseek":
            return await self._openai_compatible_completion(
                "https://api.deepseek.com/v1",
                settings.deepseek_api_key,
                messages,
                system,
                model or settings.deepseek_model,
                max_tokens
            )
        elif provider == "qwen":
            return await self._openai_compatible_completion(
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
                settings.qwen_api_key,
                messages,
                system,
                model or settings.qwen_model,
                max_tokens
            )
        elif provider == "zhipu":
            return await self._openai_compatible_completion(
                "https://open.bigmodel.cn/api/paas/v4",
                settings.zhipu_api_key,
                messages,
                system,
                model or settings.zhipu_model,
                max_tokens
            )
        elif provider == "gemini":
            # Gemini OpenAI-compatible endpoint requires the key in the URL
            return await self._openai_compatible_completion(
                f"https://generativelanguage.googleapis.com/v1beta/openai?key={settings.gemini_api_key}",
                None, # No bearer token needed when key is in URL
                messages,
                system,
                model or settings.gemini_model,
                max_tokens
            )
        else:
            raise ValueError(f"Unsupported provider: {provider}")

    async def _anthropic_completion(self, messages, system, model, max_tokens):
        resolved_model = model or settings.anthropic_model
        logger.info("llm_request", provider="anthropic", model=resolved_model,
                    system=system, messages=messages)
        response = await self.anthropic.messages.create(
            model=resolved_model,
            max_tokens=max_tokens or settings.anthropic_max_tokens,
            system=system,
            messages=messages,
        )
        result = response.content[0].text
        logger.info("llm_response", provider="anthropic", model=resolved_model,
                    response=result)
        return result

    async def _openai_compatible_completion(self, base_url, api_key, messages, system, model, max_tokens):
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

            logger.info("llm_request", provider=url.split("/")[2], model=model,
                        messages=full_messages)
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            result = data["choices"][0]["message"]["content"]
            logger.info("llm_response", provider=url.split("/")[2], model=model,
                        response=result)
            return result

llm_client = LLMClient()
