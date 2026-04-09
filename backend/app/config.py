"""
Application configuration — loaded from environment variables via pydantic-settings.
All values can be overridden by a .env file in the backend/ directory.
"""
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ────────────────────────────────────────────────────────
    app_env: str = Field(default="development", alias="APP_ENV")
    app_port: int = Field(default=9393, alias="APP_PORT")
    app_secret_key: str = Field(default="dev-secret-key", alias="APP_SECRET_KEY")
    cors_origins: list[str] = Field(
        default=["http://localhost:7373"], alias="CORS_ORIGINS"
    )

    # ── Database ───────────────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://oag:oag_pass@localhost:5432/openautogrowth",
        alias="DATABASE_URL",
    )
    database_pool_size: int = Field(default=10, alias="DATABASE_POOL_SIZE")
    database_max_overflow: int = Field(default=20, alias="DATABASE_MAX_OVERFLOW")

    # ── Redis ──────────────────────────────────────────────────────
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    arq_redis_url: str = Field(default="redis://localhost:6379/1", alias="ARQ_REDIS_URL")

    # ── LLM Providers ──────────────────────────────────────────────
    # Anthropic
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(default="claude-3-5-sonnet-20241022", alias="ANTHROPIC_MODEL")
    anthropic_max_tokens: int = Field(default=4096, alias="ANTHROPIC_MAX_TOKENS")

    # Gemini
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-1.5-pro", alias="GEMINI_MODEL")

    # DeepSeek
    deepseek_api_key: str = Field(default="", alias="DEEPSEEK_API_KEY")
    deepseek_model: str = Field(default="deepseek-chat", alias="DEEPSEEK_MODEL")

    # Qwen (DashScope)
    qwen_api_key: str = Field(default="", alias="QWEN_API_KEY")
    qwen_model: str = Field(default="qwen-max", alias="QWEN_MODEL")

    # Zhipu AI (GLM)
    zhipu_api_key: str = Field(default="", alias="ZHIPU_API_KEY")
    zhipu_model: str = Field(default="glm-4", alias="ZHIPU_MODEL")

    # ── Ad Platforms ───────────────────────────────────────────────
    meta_app_id: str = Field(default="", alias="META_APP_ID")
    meta_app_secret: str = Field(default="", alias="META_APP_SECRET")
    meta_access_token: str = Field(default="", alias="META_ACCESS_TOKEN")

    tiktok_app_id: str = Field(default="", alias="TIKTOK_APP_ID")
    tiktok_app_secret: str = Field(default="", alias="TIKTOK_APP_SECRET")

    google_ads_developer_token: str = Field(default="", alias="GOOGLE_ADS_DEVELOPER_TOKEN")
    google_ads_client_id: str = Field(default="", alias="GOOGLE_ADS_CLIENT_ID")
    google_ads_client_secret: str = Field(default="", alias="GOOGLE_ADS_CLIENT_SECRET")
    google_ads_refresh_token: str = Field(default="", alias="GOOGLE_ADS_REFRESH_TOKEN")

    # ── Image Generation ───────────────────────────────────────────
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    stability_api_key: str = Field(default="", alias="STABILITY_API_KEY")

    # ── ARQ Worker ─────────────────────────────────────────────────
    arq_max_jobs: int = Field(default=10, alias="ARQ_MAX_JOBS")
    arq_job_timeout: int = Field(default=300, alias="ARQ_JOB_TIMEOUT")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
