# 13 — 部署与本地开发指南

> Version: 1.0 | Date: 2026-04-09

## 1. 服务端口清单

| 服务 | 端口 | 说明 |
|------|------|------|
| Frontend (Vite) | 7373 | Dashboard UI |
| Backend (FastAPI) | 9393 | REST API + WebSocket |
| PostgreSQL | 5432 | 主数据库 |
| Redis | 6379 | 任务队列 + Pub/Sub |
| pgAdmin (可选) | 5050 | 数据库可视化 |

---

## 2. 环境变量清单 (.env)

```env
# ── 数据库 ─────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://oag:oag_pass@localhost:5432/openautogrowth
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=20

# ── Redis ──────────────────────────────────────────
REDIS_URL=redis://localhost:6379/0
ARQ_REDIS_URL=redis://localhost:6379/1

# ── LLM ────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS=4096

# ── 广告平台 API ────────────────────────────────────
META_APP_ID=
META_APP_SECRET=
META_ACCESS_TOKEN=
TIKTOK_APP_ID=
TIKTOK_APP_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=

# ── 图像生成 ────────────────────────────────────────
OPENAI_API_KEY=           # DALL-E 3
STABILITY_API_KEY=        # Stability AI

# ── 应用配置 ────────────────────────────────────────
APP_ENV=development       # development | production
APP_SECRET_KEY=change-me-in-production
APP_PORT=9393
CORS_ORIGINS=http://localhost:7373

# ── ARQ Worker ─────────────────────────────────────
ARQ_MAX_JOBS=10
ARQ_JOB_TIMEOUT=300       # 秒
```

---

## 3. Docker Compose（本地开发）

```yaml
# docker-compose.yml
version: "3.9"

services:
  postgres:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: openautogrowth
      POSTGRES_USER: oag
      POSTGRES_PASSWORD: oag_pass
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "9393:9393"
    environment:
      DATABASE_URL: postgresql+asyncpg://oag:oag_pass@postgres:5432/openautogrowth
      REDIS_URL: redis://redis:6379/0
      ARQ_REDIS_URL: redis://redis:6379/1
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./backend:/app
    command: uvicorn main:app --host 0.0.0.0 --port 9393 --reload

  arq_worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql+asyncpg://oag:oag_pass@postgres:5432/openautogrowth
      REDIS_URL: redis://redis:6379/0
      ARQ_REDIS_URL: redis://redis:6379/1
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./backend:/app
    command: arq app.tasks.agent_tasks.WorkerSettings

  frontend:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - .:/app
    ports:
      - "7373:7373"
    command: npm run dev -- --host 0.0.0.0

  pgadmin:
    image: dpage/pgadmin4
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@oag.local
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "5050:80"
    depends_on:
      - postgres

volumes:
  pg_data:
  redis_data:
```

---

## 4. 本地开发启动流程（不用 Docker）

```bash
# 1. 启动基础设施（仅 DB + Redis 用 Docker）
docker compose up postgres redis -d

# 2. 初始化后端
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# 3. 数据库迁移
alembic upgrade head

# 4. 启动后端
uvicorn main:app --port 9393 --reload

# 5. 启动 ARQ Worker（新终端）
arq app.tasks.agent_tasks.WorkerSettings

# 6. 启动前端（新终端，项目根目录）
npm run dev
```

---

## 5. backend/Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install -e "."

COPY . .

EXPOSE 9393
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9393"]
```

---

## 6. 数据库初始化说明

`database/schema.sql` 在 Docker Compose 启动时自动执行（`docker-entrypoint-initdb.d`）。

手动执行：
```bash
psql -U oag -d openautogrowth -f database/schema.sql
```

Alembic 管理后续变更（不重新执行 schema.sql）：
```bash
alembic revision --autogenerate -m "describe change"
alembic upgrade head
alembic downgrade -1   # 回滚一步
```

---

## 7. API 文档访问

后端启动后：
- Swagger UI: http://localhost:9393/docs
- ReDoc:       http://localhost:9393/redoc
- OpenAPI JSON: http://localhost:9393/openapi.json
