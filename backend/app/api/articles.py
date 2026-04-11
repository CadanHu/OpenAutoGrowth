from typing import List, Optional
from uuid import UUID
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.content import Copy

logger = structlog.get_logger(__name__)
router = APIRouter()

@router.get("", summary="Get historical articles")
async def list_articles(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db)
):
    """Return historical generated articles/copies."""
    query = (
        select(Copy)
        .order_by(desc(Copy.created_at))
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [
            {
                "id": str(item.id),
                "bundle_id": str(item.bundle_id),
                "campaign_id": str(item.campaign_id),
                "variant_label": item.variant_label,
                "title": item.hook,
                "body": item.body,
                "channel": item.channel,
                "status": item.status,
                "created_at": item.created_at.isoformat()
            }
            for item in items
        ]
    }


@router.delete("/{article_id}", summary="Delete an article by ID")
async def delete_article(article_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Copy).where(Copy.id == article_id))
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Article not found")
    await db.execute(delete(Copy).where(Copy.id == article_id))
    await db.commit()
    return {"deleted": str(article_id)}
