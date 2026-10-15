import os
import secrets
from pathlib import Path


def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return f"sqlite:///{Path(__file__).resolve().parent.parent / 'nagarnetra.db'}"
    # Supabase / Render give postgres:// or postgresql:// URLs; SQLAlchemy needs the driver name.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Settings:
    database_url = _db_url()
    secret_key = os.getenv("SECRET_KEY") or secrets.token_hex(32)
    admin_email = os.getenv("ADMIN_EMAIL", "admin@nagarnetra.app").strip().lower()
    admin_password = os.getenv("ADMIN_PASSWORD", "")

    watsonx_apikey = os.getenv("WATSONX_APIKEY", "").strip()
    watsonx_project_id = os.getenv("WATSONX_PROJECT_ID", "").strip()
    watsonx_url = os.getenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com").rstrip("/")
    watsonx_model = os.getenv("WATSONX_MODEL", "").strip()  # optional override; auto-picked otherwise

    seed_demo = os.getenv("SEED_DEMO", "true").lower() in ("1", "true", "yes")
    # Render sets RENDER_EXTERNAL_URL itself; pinging it keeps a free instance from sleeping.
    keepalive_url = (os.getenv("KEEPALIVE_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
    keepalive = os.getenv("KEEPALIVE", "true").lower() in ("1", "true", "yes")
    cookie_secure = os.getenv("COOKIE_SECURE", "auto")
    static_dir = Path(os.getenv("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))

    @property
    def ai_configured(self) -> bool:
        return bool(self.watsonx_apikey and self.watsonx_project_id)


settings = Settings()
