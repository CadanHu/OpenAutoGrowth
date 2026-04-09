"""
ContentGen Agent Node — LLM-powered A/B copy generation.

Input:  state.strategy, state.goal, state.constraints
Output: state.content  (bundle_id + variants[])
Events: ContentGenerated
"""
import json
import re
import uuid

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.core.event_bus import event_bus
from app.core.llm import llm_client
from .state import CampaignState

logger = structlog.get_logger(__name__)


async def _get_github_readme(url: str) -> str:
    """Fetch README from GitHub URL."""
    # Convert GitHub repo URL to raw user content URL if needed
    match = re.match(r"https://github\.com/([^/]+)/([^/]+)/?$", url)
    if match:
        owner, repo = match.groups()
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/main/README.md"

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url)
            if resp.status_code == 404:
                # Try master branch if main fails
                url = url.replace("/main/", "/master/")
                resp = await client.get(url)
            resp.raise_for_status()
            return resp.text
        except Exception as exc:
            logger.warning("github_readme_fetch_failed", url=url, error=str(exc))
            return ""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
async def _call_llm(prompt: str, is_article: bool = False) -> list[dict]:
    """Call LLM to generate copy variants. Retries 3x on transient errors."""
    system_prompt = (
        "You are a senior performance marketing copywriter and technical evangelist. "
        "Return a JSON array of copy variants."
    )

    if is_article:
        system_prompt += (
            " Each variant must have: variant_label (A/B/C), title, body (the full Markdown article), channel. "
            "The body should be a high-quality, professional technical article in Markdown format, "
            "suitable for Zhihu, Juejin, or CSDN. "
        )
    else:
        system_prompt += (
            " Each variant must have: variant_label (A/B/C), hook, body, cta, channel. "
        )

    system_prompt += "Output ONLY valid JSON, no markdown outside the JSON structure."

    raw = await llm_client.chat_completion(
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    # Clean up potential markdown code blocks if the LLM includes them
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif raw.startswith("```"):
        raw = raw.split("```")[1].split("```")[0].strip()

    return json.loads(raw)


async def content_gen_node(state: CampaignState) -> dict:
    """
    LangGraph node: generate A/B copy variants via Claude.
    """
    logger.info("content_gen_start", campaign_id=state["campaign_id"])

    strategy = state.get("strategy") or {}
    channels = strategy.get("channel_plan", [{"channel": "tiktok"}, {"channel": "meta"}])
    channel_names = [c["channel"] for c in channels]
    is_technical_promo = any(ch in ["zhihu", "juejin", "csdn"] for ch in channel_names)

    # Analyze external repo if URL is in goal or constraints
    repo_content = ""
    repo_url_match = re.search(r"https://github\.com/[^\s]+", state["goal"])
    if repo_url_match:
        repo_url = repo_url_match.group(0)
        repo_content = await _get_github_readme(repo_url)

    prompt = (
        f"Product goal: {state['goal']}\n"
        f"Target channels: {', '.join(channel_names)}\n"
        f"KPI target: {state.get('kpi', {}).get('metric', 'awareness')} = {state.get('kpi', {}).get('target', 'high')}\n"
    )

    if repo_content:
        prompt += f"\nProject Context (README):\n{repo_content[:4000]}\n"

    if is_technical_promo:
        prompt += (
            "\nFocus on deep technical analysis. Generate a comprehensive technical article "
            "that highlights the project's innovation, architecture, and value proposition."
        )
    else:
        prompt += "\nGenerate 3 A/B/C copy variants optimized for these channels."

    try:
        variants = await _call_llm(prompt, is_article=is_technical_promo)

        bundle = {
            "bundle_id": f"bundle_{uuid.uuid4().hex[:8]}",
            "variants": variants,
            "llm_model": settings.anthropic_model,
        }

        await event_bus.publish(
            "ContentGenerated",
            {"bundle": bundle},
            state["campaign_id"],
        )

        logger.info("content_gen_done", variants=len(variants))
        return {
            "content": bundle,
            "status": "PRODUCTION",
            "completed_tasks": ["content_gen"],
        }

    except Exception as exc:
        logger.error("content_gen_error", error=str(exc))
        return {"errors": [{"node": "content_gen", "error": str(exc)}]}
