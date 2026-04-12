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


async def _get_github_context(url: str) -> str:
    """
    Fetch comprehensive project context from GitHub:
    metadata, directory structure, recent commits, dependency files, README.
    Falls back gracefully — each section is independently optional.
    """
    match = re.match(r"https://github\.com/([^/]+)/([^/\s]+?)(?:\.git)?/?$", url)
    if not match:
        logger.warning("github_url_not_repo", url=url)
        return ""

    owner, repo = match.groups()
    api_base = f"https://api.github.com/repos/{owner}/{repo}"
    raw_base = f"https://raw.githubusercontent.com/{owner}/{repo}"
    api_headers = {"Accept": "application/vnd.github.v3+json"}
    parts: list[str] = []

    async with httpx.AsyncClient(timeout=30) as client:

        # ── 1. Repository metadata ────────────────────────────────────────
        try:
            r = await client.get(api_base, headers=api_headers)
            if r.status_code == 200:
                m = r.json()
                topics = ", ".join(m.get("topics") or []) or "N/A"
                parts.append(
                    f"[Meta] Stars:{m.get('stargazers_count', 0)} | "
                    f"Forks:{m.get('forks_count', 0)} | "
                    f"Language:{m.get('language', 'N/A')} | "
                    f"Topics:{topics} | "
                    f"Description:{m.get('description', '')}"
                )
                logger.info("github_meta_fetched", owner=owner, repo=repo)
        except Exception as exc:
            logger.warning("github_meta_failed", error=str(exc))

        # ── 2. Root directory structure ───────────────────────────────────
        try:
            r = await client.get(f"{api_base}/git/trees/HEAD", headers=api_headers)
            if r.status_code == 200:
                entries = [item["path"] for item in r.json().get("tree", [])]
                parts.append(f"[Structure] {' | '.join(entries[:50])}")
                logger.info("github_tree_fetched", entries=len(entries))
        except Exception as exc:
            logger.warning("github_tree_failed", error=str(exc))

        # ── 3. Recent commits (last 5) ────────────────────────────────────
        try:
            r = await client.get(f"{api_base}/commits?per_page=5", headers=api_headers)
            if r.status_code == 200:
                msgs = [c["commit"]["message"].split("\n")[0] for c in r.json()[:5]]
                parts.append(f"[Recent Commits] {' | '.join(msgs)}")
                logger.info("github_commits_fetched", count=len(msgs))
        except Exception as exc:
            logger.warning("github_commits_failed", error=str(exc))

        # ── 4. Dependency file (first match across branches) ──────────────
        dep_candidates = [
            "requirements.txt", "pyproject.toml",
            "package.json", "go.mod", "Cargo.toml",
        ]
        dep_found = False
        for fname in dep_candidates:
            if dep_found:
                break
            for branch in ("main", "master"):
                try:
                    r = await client.get(f"{raw_base}/{branch}/{fname}")
                    if r.status_code == 200:
                        parts.append(f"[{fname}]\n{r.text[:800]}")
                        logger.info("github_dep_fetched", file=fname, branch=branch)
                        dep_found = True
                        break
                except Exception:
                    continue

        # ── 5. README ─────────────────────────────────────────────────────
        readme = ""
        for branch in ("main", "master"):
            try:
                r = await client.get(f"{raw_base}/{branch}/README.md")
                if r.status_code == 200:
                    readme = r.text
                    logger.info("github_readme_fetched", branch=branch, length=len(readme))
                    break
            except Exception as exc:
                logger.warning("github_readme_fetch_failed", branch=branch, error=str(exc))

        if readme:
            parts.append(f"[README]\n{readme[:3000]}")

    return "\n\n".join(parts)


# NOTE: 2 attempts max — article generation is slow (~90s), 3 retries would hit ARQ 300s job limit.
@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=2, max=5))
async def _call_llm(prompt: str, is_article: bool = False) -> list[dict]:
    """Call LLM to generate copy variants. Retries 3x on transient errors."""
    system_prompt = (
        "You are a senior performance marketing copywriter and technical evangelist. "
        "Return a JSON array of copy variants."
    )

    if is_article:
        system_prompt += (
            " Generate exactly ONE article variant with fields: variant_label (set to 'A'), title, body, channel. "
            "The body must be plain text only — absolutely NO Markdown syntax: no ##, no **, no -, no `, no >. "
            "Structure the article like an academic paper: use numbered section headings like '1. 节名', '2. 节名', '2.1 小节名' on their own lines. "
            "Each section should have multiple paragraphs separated by a blank line. Write in depth — aim for 1500+ Chinese characters. "
            "IMPORTANT: The title MUST be 15 Chinese characters or fewer — count carefully, this is a hard limit."
        )
    else:
        system_prompt += (
            " Each variant must have: variant_label (A/B/C), title (MAX 15 chars), hook, body, cta, channel. "
        )

    system_prompt += "Output ONLY valid JSON, no markdown outside the JSON structure."

    raw = await llm_client.chat_completion(
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8192 if is_article else 2048,
    )
    # Extract JSON array — find outermost [ ... ] to avoid being fooled
    # by code blocks (```python, ```yaml etc.) inside the article body.
    start = raw.find('[')
    end = raw.rfind(']')
    if start != -1 and end != -1:
        raw = raw[start:end + 1]

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("content_gen_json_parse_error", error=str(e), raw_snippet=raw[:300])
        raise


async def content_gen_node(state: CampaignState) -> dict:
    """
    LangGraph node: generate A/B copy variants via Claude.
    """
    logger.info("content_gen_start", campaign_id=state["campaign_id"])

    strategy = state.get("strategy") or {}
    channels = strategy.get("channel_plan", [{"channel": "tiktok"}, {"channel": "meta"}])
    channel_names = [c["channel"] for c in channels]
    is_technical_promo = any(ch in ["zhihu", "juejin", "csdn"] for ch in channel_names)

    # Fetch comprehensive project context if a GitHub URL is present in goal
    repo_context = ""
    repo_url_match = re.search(r"https://github\.com/[^\s]+", state["goal"])
    if repo_url_match:
        repo_url = repo_url_match.group(0)
        repo_context = await _get_github_context(repo_url)

    prompt = (
        f"Product goal: {state['goal']}\n"
        f"Target channels: {', '.join(channel_names)}\n"
        f"KPI target: {state.get('kpi', {}).get('metric', 'awareness')} = {state.get('kpi', {}).get('target', 'high')}\n"
    )

    if repo_context:
        prompt += f"\nProject Context:\n{repo_context}\n"

    if is_technical_promo:
        prompt += (
            "\nGenerate ONE comprehensive technical article (variant_label: 'A'). "
            "Return a JSON array with exactly 1 variant.\n"
            "CRITICAL RULE — title字数: 标题必须≤15个汉字，例如'DataPulse架构深度解析'(12字)是合法的，"
            "'DataPulse v3.1深度解析：从多模型到知识图谱'(超过15字)是不合法的。"
            "生成前请数清楚字数，超过15字必须重新起名。"
        )
    else:
        prompt += "\nGenerate 3 A/B/C copy variants optimized for these channels."

    try:
        variants = await _call_llm(prompt, is_article=is_technical_promo)

        bundle_id = uuid.uuid4()
        bundle_data = {
            "bundle_id": str(bundle_id),
            "variants": variants,
            "llm_model": settings.gemini_model,
        }

        # ── Persistence Layer ─────────────────────────────────────────────
        from app.database import async_session_factory
        from app.models.content import ContentBundle, Copy

        async with async_session_factory() as db:
            # Ensure campaign exists (it might be 'demo' in some contexts,
            # we should skip persistence for demo or handle it)
            campaign_id = state.get("campaign_id")
            DEMO_UUID = uuid.UUID("00000000-0000-0000-0000-000000000001")
            try:
                camp_uuid = DEMO_UUID if campaign_id == "demo" else uuid.UUID(campaign_id)

                new_bundle = ContentBundle(
                    id=bundle_id,
                    campaign_id=camp_uuid,
                    llm_model=settings.gemini_model,
                    generation_params={"tone": state.get("tone", "professional")},
                )
                db.add(new_bundle)

                for var in variants:
                    new_copy = Copy(
                        bundle_id=bundle_id,
                        campaign_id=camp_uuid,
                        variant_label=var.get("variant_label", "A"),
                        hook=var.get("title") or var.get("hook") or "Untitled",
                        body=var.get("body"),
                        cta=var.get("cta"),
                        channel=var.get("channel"),
                        status="GENERATED"
                    )
                    db.add(new_copy)

                await db.commit()
                logger.info("content_gen_persisted", bundle_id=str(bundle_id))
            except (ValueError, TypeError):
                logger.warning("content_gen_persistence_skipped", campaign_id=campaign_id)

        await event_bus.publish(
            "ContentGenerated",
            {"bundle": bundle_data},
            state["campaign_id"],
        )

        logger.info("content_gen_done", variants=len(variants))
        return {
            "content": bundle_data,
            "status": "PRODUCTION",
            "completed_tasks": ["content_gen"],
        }

    except Exception as exc:
        logger.error("content_gen_error", error=str(exc))
        return {"errors": [{"node": "content_gen", "error": str(exc)}]}
