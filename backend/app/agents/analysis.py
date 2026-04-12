import httpx
from bs4 import BeautifulSoup
from typing import Dict, Any, Optional
from app.core.llm import llm_client
from app.config import settings
import logging
import re
import json
import uuid
from datetime import datetime, timezone
from app.core.event_bus import event_bus
from .state import CampaignState

logger = logging.getLogger(__name__)

# --- URL Analysis Tools ---

class URLAnalyzer:
    def __init__(self):
        self.llm = llm_client

    async def fetch_page_content(self, url: str) -> str:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')
                for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
                    tag.decompose()
                text = soup.get_text(separator=' ', strip=True)
                return text[:8000]
            except Exception as e:
                logger.error(f"Error fetching URL {url}: {e}")
                return ""

    async def analyze(self, url: str, campaign_type: str = "ecom") -> Dict[str, Any]:
        raw_text = await self.fetch_page_content(url)
        if not raw_text:
            return {"error": "Could not fetch content from URL"}

        prompt = f"""
        Analyze the following raw web content from a {campaign_type} landing page: {url}
        Content:
        ---
        {raw_text}
        ---

        Act as a senior marketing strategist. Extract and structure the following info in JSON:
        1. product_name: Official name of the product or project.
        2. description: A clear, compelling 1-sentence marketing pitch.
        3. core_usps: Top 3-5 unique selling points (USPs).
        4. target_audience: Primary audience (who is this for?).
        5. campaign_goal_suggested: Recommended campaign objective (brand_awareness, user_growth, sales_conversion, website_traffic).
        6. suggested_tone: (professional, energetic, tech-savvy, luxury).

        Return ONLY the raw JSON.
        """

        try:
            response_text = await self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                system="You are an expert AI marketing analyzer. Output strictly valid JSON.",
                model=settings.gemini_model
            )
            json_str = re.search(r'(\{.*\})', response_text.replace('\n', ' '), re.DOTALL).group(1)
            return json.loads(json_str)
        except Exception as e:
            logger.error(f"Error analyzing URL with LLM: {e}")
            return {"error": "AI analysis failed"}

url_analyzer = URLAnalyzer()

# --- LangGraph Nodes: Performance Analysis ---

_THRESHOLDS = {
    "ctr":  {"min": 0.005, "max": 0.20},
    "roas": {"min": 0.5,   "max": 20.0},
    "cvr":  {"min": 0.001, "max": 0.5},
}

def _detect_anomalies(metrics: dict[str, float]) -> list[dict]:
    anomalies = []
    for metric, value in metrics.items():
        bounds = _THRESHOLDS.get(metric)
        if bounds is None: continue
        if value < bounds["min"]:
            anomalies.append({
                "metric": metric, "actual": value, "expected_min": bounds["min"], 
                "severity": "HIGH", "description": f"{metric} is critically below threshold"
            })
        elif value > bounds["max"]:
            anomalies.append({
                "metric": metric, "actual": value, "expected_max": bounds["max"], 
                "severity": "MEDIUM", "description": f"{metric} is suspiciously high"
            })
    return anomalies

async def analysis_node(state: CampaignState) -> dict:
    """LangGraph node: pull metrics and detect anomalies."""
    logger.info("analysis_start", campaign_id=state["campaign_id"])
    
    # Stub: simulated metrics for MVP
    metrics = {
        "impressions": 125000, "clicks": 3750, "conversions": 187,
        "spend": 15000, "revenue": 52500, "ctr": 0.03, "cvr": 0.05,
        "roas": 3.5, "roi": 2.5
    }
    
    anomalies = _detect_anomalies(metrics)
    report = {
        "report_id": f"report_{uuid.uuid4().hex[:8]}",
        "metrics": metrics,
        "anomaly_count": len(anomalies),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    await event_bus.publish("ReportGenerated", {"metrics": metrics}, state["campaign_id"])
    for anomaly in anomalies:
        await event_bus.publish("AnomalyDetected", anomaly, state["campaign_id"])

    return {
        "report": report,
        "anomalies": anomalies,
        "status": "MONITORING",
        "completed_tasks": ["analysis"],
    }
