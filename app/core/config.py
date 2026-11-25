from pathlib import Path

from pydantic import BaseModel, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class ApiV1Prefix(BaseModel):
    prefix: str = "/v1"


class ApiPrefix(BaseModel):
    prefix: str = "/api"
    v1: ApiV1Prefix = ApiV1Prefix()


class DatabaseConfig(BaseModel):
    # the app connects as a role that doesn't own the tables, so row-level security applies to it
    url: PostgresDsn
    # migrations run as the owner role; falls back to url
    migration_url: PostgresDsn | None = None
    echo: bool = False
    echo_pool: bool = False
    # per worker process: keep workers * (pool_size + max_overflow) below Postgres max_connections
    max_overflow: int = 5
    pool_size: int = 5

    naming_convention: dict[str, str] = {
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    }


class AuthConfig(BaseModel):
    cookie_name: str = "session"
    # browsers accept Secure cookies on http://localhost, so this stays on in development
    cookie_secure: bool = True
    session_days: int = 30
    # failed logins allowed per login or IP address within the window
    max_failures: int = 10
    failure_window_minutes: int = 15
    # per IP address: new companies in an hour, and login, sign-up and password requests in a
    # minute (an office or a phone network can sit behind one address, so not too low)
    signups_per_hour: int = 10
    requests_per_minute: int = 30


class TracingConfig(BaseModel):
    enabled: bool = False
    console: bool = False
    otlp_endpoint: str = "http://localhost:4317"
    service_name: str = "open-erp"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # absolute: uvicorn runs from the repo root, alembic from app/
        env_file=Path(__file__).resolve().parents[2] / ".env",
        case_sensitive=False,
        env_nested_delimiter="__",
        env_prefix="MAIN_CONFIG__",
    )
    api: ApiPrefix = ApiPrefix()
    db: DatabaseConfig
    auth: AuthConfig = AuthConfig()
    debug: bool = False
    tracing: TracingConfig = TracingConfig()


settings = Settings()
