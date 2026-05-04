
import asyncio
import uuid
from app.tasks.agent_tasks import run_campaign_pipeline
from app.core.event_bus import event_bus

async def test():
    await event_bus.connect()
    cid = '7618e334-ed56-4fa2-94ca-db8d4ca1484c'
    print(f"Running pipeline for {cid}...")
    # Mocking ctx for arq
    ctx = {}
    result = await run_campaign_pipeline(ctx, cid)
    print("Result:", result)
    await event_bus.disconnect()

if __name__ == "__main__":
    asyncio.run(test())
