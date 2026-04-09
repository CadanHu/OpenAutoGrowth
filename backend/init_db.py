"""
Local dev DB initializer — creates all tables from SQLAlchemy ORM models.
Does NOT require pgvector or schema.sql.

Usage:
    python init_db.py
    python init_db.py --drop   # drop all tables first (destructive!)
"""
import asyncio
import sys
from sqlalchemy import text
from app.database import engine, Base
import app.models  # noqa — registers all ORM models with Base


async def init(drop_first: bool = False):
    async with engine.begin() as conn:

        # pgcrypto for gen_random_uuid() — available on PG14
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        print("✓  Extension pgcrypto ready")

        if drop_first:
            print("⚠  Dropping all tables...")
            await conn.run_sync(Base.metadata.drop_all)

        await conn.run_sync(Base.metadata.create_all)
        print("✓  All ORM tables created")

        # Quick sanity check
        result = await conn.execute(
            text("SELECT table_name FROM information_schema.tables "
                 "WHERE table_schema='public' ORDER BY table_name")
        )
        tables = [row[0] for row in result]
        print(f"✓  Tables in DB ({len(tables)}): {', '.join(tables)}")

    await engine.dispose()
    print("\n✅  Database ready — run: uvicorn main:app --port 9393 --reload")


if __name__ == "__main__":
    drop = "--drop" in sys.argv
    asyncio.run(init(drop_first=drop))
