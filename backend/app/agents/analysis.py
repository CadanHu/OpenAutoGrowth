"""
Analysis Agent Node — metrics pull, attribution, anomaly detection.

Input:  state.deployed_ads, state.campaign_id
Output: state.report, state.anomalies
Events: ReportGenerated, AnomalyDetected
"""
import uuid
from datetime import datetime, timezone

import structlog

from app.core.event_bus import event_bus
from .state import CampaignState

logger = structlog.get_logger(__name__)

# Anomaly detection thresholds
_THRESHOLDS = {
    "ctr":  {"min": 0.005, "max": 0.20},
    "roas": {"min": 0.5,   "max": 20.0},
    "cvr":  {"min": 0.001, "max": 0.5},
}


def _detect_anomalies(metrics: dict[str, float]) -> list[dict]:
    anomalies = []
    for metric, value in metrics.items():
        bounds = _THRESHOLDS.get(metric)
        if bounds is None:
            continue
        if value < bounds["min"]:
            anomalies.append({
                "metric": metric, "actual": value,
                "expected_min": bounds["min"], "severity": "HIGH",
                "description": f"{metric} is critically below threshold",
            })
        elif value > bounds["max"]:
            anomalies.append({
                "metric": metric, "actual": value,
                "expected_max": bounds["max"], "severity": "MEDIUM",
                "description": f"{metric} is suspiciously high",
            })
    return anomalies


async def _pull_platform_metrics(deployed_ads: dict) -> dict[str, float]:
    """
    Pull performance data from ad platforms.
    Production: call Meta/TikTok/Google reporting APIs.
    Stub: returns simulated metrics.
    """
    # TODO: replace with real platform API calls
    return {
        "impressions": 125000,
        "clicks": 3750,
        "conversions": 187,
        "spend": 15000,        # cents
        "revenue": 52500,      # cents
        "ctr":  3750 / 125000,
        "cvr":  187 / 3750,
        "cpc":  15000 / 3750,
        "roas": 52500 / 15000,
        "roi":  (52500 - 15000) / 15000,
    }


async def analysis_node(state: CampaignState) -> dict:
    """LangGraph node: pull metrics and detect anomalies."""
    logger.info("analysis_start", campaign_id=state["campaign_id"])

    deployed_ads = state.get("deployed_ads") or {}

    try:
        metrics = await _pull_platform_metrics(deployed_ads)
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

        logger.info("analysis_done", roas=metrics.get("roas"), anomalies=len(anomalies))
        return {
            "report": report,
            "anomalies": anomalies,
            "status": "MONITORING",
            "completed_tasks": ["analysis"],
        }

    except Exception as exc:
        logger.error("analysis_error", error=str(exc))
        return {"errors": [{"node": "analysis", "error": str(exc)}]}
