
import asyncio
import uuid
from sqlalchemy import select
from app.database import async_session_factory
from app.models.campaign import Campaign, DomainEvent

async def check():
    async with async_session_factory() as db:
        cid = uuid.UUID('7618e334-ed56-4fa2-94ca-db8d4ca1484c')
        campaign = await db.get(Campaign, cid)
        if not campaign:
            print("Campaign not found")
            return
        print(f"Status: {campaign.status}")
        
        result = await db.execute(
            select(DomainEvent).where(DomainEvent.campaign_id == cid).order_by(DomainEvent.occurred_at.desc())
        )
        events = result.scalars().all()
        print(f"Events ({len(events)}):")
        for e in events:
            print(f"  {e.occurred_at} - {e.event_type} - {e.payload}")

if __name__ == "__main__":
    asyncio.run(check())
