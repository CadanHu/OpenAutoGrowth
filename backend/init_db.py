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

        # Seed default organization
        from app.models.user import Organization
        await conn.execute(
            text("INSERT INTO organizations (id, name, slug) VALUES "
                 "(:id, 'Default Org', 'default-org') ON CONFLICT (slug) DO NOTHING"),
            {"id": "00000000-0000-0000-0000-000000000001"}
        )
        print("✓  Default organization seeded")

        # Seed the Phase-0 governance rule: any campaign with total budget
        # >= 50,000 (DB unit; cents) must be approved by FINANCE before
        # content generation begins. ON CONFLICT keeps re-runs idempotent.
        await conn.execute(
            text("""
                INSERT INTO governance_rules
                    (id, code, name, description, "when", require_role, stage_before, sla_hours, enabled)
                VALUES
                    (gen_random_uuid(),
                     'finance_high_budget',
                     'Finance approval — high budget',
                     'Campaigns whose total budget meets or exceeds the threshold require Finance sign-off before any creative spend.',
                     '{"budget_total_gte": 50000}'::jsonb,
                     'FINANCE',
                     'content_gen',
                     8,
                     TRUE)
                ON CONFLICT (code) DO NOTHING
            """)
        )
        print("✓  Governance rule 'finance_high_budget' seeded")

        # Sample rules for LEGAL + MARKETING_DIRECTOR. Same idempotent
        # ON CONFLICT trick keeps re-running init_db.py safe.
        await conn.execute(
            text("""
                INSERT INTO governance_rules
                    (id, code, name, description, "when", require_role, stage_before, sla_hours, enabled)
                VALUES
                    (gen_random_uuid(),
                     'legal_cross_border',
                     'Legal review — cross-border campaign',
                     'Requires Legal sign-off when the campaign targets a region outside its home market.',
                     '{"regions_outside_home": true}'::jsonb,
                     'LEGAL', 'channel_exec', 48, TRUE)
                ON CONFLICT (code) DO NOTHING
            """)
        )
        await conn.execute(
            text("""
                INSERT INTO governance_rules
                    (id, code, name, description, "when", require_role, stage_before, sla_hours, enabled)
                VALUES
                    (gen_random_uuid(),
                     'director_loop_escalation',
                     'Director escalation — KPI not met after 2 loops',
                     'Marketing Director must approve continued optimization once the campaign has run two full loops without hitting its KPI target.',
                     '{"loop_count_gte": 2, "kpi_met": false}'::jsonb,
                     'MARKETING_DIRECTOR', 'optimizer', 12, TRUE)
                ON CONFLICT (code) DO NOTHING
            """)
        )
        await conn.execute(
            text("""
                INSERT INTO governance_rules
                    (id, code, name, description, "when", require_role, stage_before, sla_hours, enabled)
                VALUES
                    (gen_random_uuid(),
                     'brand_first_creative',
                     'Brand review — new-launch creative',
                     'Brand lead must sign off on creative for any campaign whose goal mentions a launch, rebranding, or new product introduction.',
                     '{"goal_contains": ["launch", "首发", "新品", "rebrand", "上新", "发布"]}'::jsonb,
                     'BRAND_LEAD', 'reviewer', 24, TRUE)
                ON CONFLICT (code) DO NOTHING
            """)
        )
        print("✓  Sample LEGAL / MARKETING_DIRECTOR / BRAND_LEAD rules seeded")

        # Seed a default admin (Phase 1A). Idempotent: skip if any user with
        # this email already exists. Password is bcrypt-hashed via passlib.
        from app.core.security import hash_password
        admin_email = "admin@openautogrowth.local"
        admin_pwd_hash = hash_password("admin1234")
        await conn.execute(
            text("""
                INSERT INTO users (id, org_id, email, hashed_password, role, tenant_id, is_active)
                VALUES (
                    gen_random_uuid(),
                    :org_id,
                    :email,
                    :pwd,
                    'ADMIN',
                    :org_id,
                    TRUE
                )
                ON CONFLICT (email) DO NOTHING
            """),
            {
                "org_id": "00000000-0000-0000-0000-000000000001",
                "email": admin_email,
                "pwd": admin_pwd_hash,
            },
        )
        # Grant ALL governance roles to the seed admin so a single login can
        # exercise every approval path (FINANCE / LEGAL / BRAND_LEAD /
        # MARKETING_DIRECTOR + ADMIN-wildcard). Real deployments override
        # this by creating per-role users via POST /v1/identity/users.
        await conn.execute(
            text("""
                INSERT INTO user_governance_roles (id, user_id, role, tenant_id)
                SELECT gen_random_uuid(), u.id, r.role, u.tenant_id
                FROM users u
                CROSS JOIN (VALUES
                    ('ADMIN'::governance_role),
                    ('FINANCE'),
                    ('LEGAL'),
                    ('BRAND_LEAD'),
                    ('MARKETING_DIRECTOR')
                ) AS r(role)
                WHERE u.email = :email
                ON CONFLICT (user_id, role, tenant_id) DO NOTHING
            """),
            {"email": admin_email},
        )
        print(f"✓  Admin seeded ({admin_email} / admin1234) — granted all 5 governance roles")

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
