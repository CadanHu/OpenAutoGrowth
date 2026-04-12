"""
Reviewer Agent Node — Quality control and compliance check.

Input:  state.content
Output: state.review_result (APPROVED/REJECTED), state.review_feedback
"""
import json
import structlog
from app.core.llm import llm_client
from .state import CampaignState

logger = structlog.get_logger(__name__)

async def reviewer_node(state: CampaignState) -> dict:
    """
    LangGraph node: Review generated content for quality and constraints.
    """
    logger.info("reviewer_start", campaign_id=state["campaign_id"])

    content_bundle = state.get("content")
    if not content_bundle or not content_bundle.get("variants"):
        return {"review_result": "REJECTED", "review_feedback": "No content found to review."}

    variants = content_bundle["variants"]
    
    prompt = (
        f"Goal: {state['goal']}\n"
        f"Generated Content: {json.dumps(variants, ensure_ascii=False)}\n\n"
        "As a Senior Editor, review the above content. Check for:\n"
        "1. Compliance: No prohibited or offensive language.\n"
        "2. Constraints: Titles MUST be <= 15 chars. No Markdown (##, **, etc.) in body.\n"
        "3. Quality: Does it effectively promote the goal? Is the technical logic sound?\n\n"
        "Return a JSON object: {\"status\": \"APPROVED\" | \"REJECTED\", \"feedback\": \"...\"}"
    )

    try:
        raw_response = await llm_client.chat_completion(
            system="You are a strict content auditor. Output ONLY valid JSON.",
            messages=[{"role": "user", "content": prompt}],
            provider="gemini", # Use Gemini 1.5 Pro for auditing
            model=settings.gemini_model
        )
        
        # Simple JSON extraction
        start = raw_response.find('{')
        end = raw_response.rfind('}')
        result = json.loads(raw_response[start:end+1])
        
        status = result.get("status", "REJECTED")
        feedback = result.get("feedback", "No feedback provided.")

        logger.info("reviewer_done", status=status, feedback=feedback)

        return {
            "review_result": status,
            "review_feedback": feedback,
            "completed_tasks": state.get("completed_tasks", []) + ["reviewer"]
        }

    except Exception as exc:
        logger.error("reviewer_error", error=str(exc))
        return {"review_result": "REJECTED", "review_feedback": f"Reviewer failed: {str(exc)}"}
