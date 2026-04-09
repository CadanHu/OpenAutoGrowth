FROM python:3.12-slim

WORKDIR /app

# System deps for asyncpg (psycopg build)
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (cache layer)
COPY pyproject.toml .
RUN pip install --no-cache-dir -e "."

# Copy source
COPY . .

EXPOSE 9393

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9393"]
