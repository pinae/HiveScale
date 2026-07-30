"""Django settings for HiveScale.

Everything deployment-specific comes from environment variables so the same
settings module works for local dev (docker-compose), CI, and production.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# Dev front end runs on Vite (:5173). With the default Vite proxy, API calls are
# same-origin; these settings additionally support pointing the SPA straight at
# the backend (cross-origin) and keep Django's CSRF origin check happy for any
# session-authenticated views (e.g. the admin) reached across origins.
_DEV_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ALLOWED_ORIGINS = os.environ.get("DJANGO_CORS_ALLOWED_ORIGINS", _DEV_ORIGINS).split(",")
CORS_ALLOW_CREDENTIALS = True  # the bg_player session cookie must ride along
CSRF_TRUSTED_ORIGINS = os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", _DEV_ORIGINS).split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # CorsMiddleware must precede CommonMiddleware so preflight/ACAO headers are
    # attached before any response-shaping runs.
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Database configuration, in priority order:
#   1. DATABASE_URL (12-factor URL) — used by docker-compose dev, CI, and the
#      e2e stack, which already export it (incl. sqlite:// for tests).
#   2. Discrete DB_* vars mapped straight onto Django's native DATABASES keys —
#      the Django-recommended form and what the production Ansible template sets.
#   3. sqlite fallback — keeps `pytest` runnable with zero services.
if os.environ.get("DATABASE_URL"):
    import dj_database_url

    DATABASES = {"default": dj_database_url.config(conn_max_age=60)}
elif os.environ.get("DB_NAME"):
    DATABASES = {
        "default": {
            "ENGINE": os.environ.get("DB_ENGINE", "django.db.backends.postgresql"),
            "NAME": os.environ["DB_NAME"],
            "USER": os.environ.get("DB_USER", ""),
            "PASSWORD": os.environ.get("DB_PASSWORD", ""),
            "HOST": os.environ.get("DB_HOST", "localhost"),
            "PORT": os.environ.get("DB_PORT", ""),
            "CONN_MAX_AGE": 60,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# collectstatic target; served by nginx from /app/static in production.
STATIC_ROOT = os.environ.get("DJANGO_STATIC_ROOT", BASE_DIR / "static")

# Uploaded media (WP-future: image Things); served by nginx from /app/media.
MEDIA_URL = "media/"
MEDIA_ROOT = os.environ.get("DJANGO_MEDIA_ROOT", BASE_DIR / "media")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Behind a TLS-terminating reverse proxy (Traefik in production), trust its
# X-Forwarded-Proto so request.is_secure() reflects the real HTTPS request —
# needed for correct admin CSRF and Secure cookies. Only enabled when the
# environment sets the flag, so a directly-reachable dev server can't be fooled
# by a spoofed header.
if os.environ.get("DJANGO_SECURE_PROXY_SSL_HEADER") == "1":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# In production (DEBUG off) the site is HTTPS-only, so scope cookies to HTTPS.
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # The game API authenticates via its own signed bg_player cookie (WP-04) and
    # its state-changing calls carry signed tokens (round/claim). It must not use
    # Django-session auth — otherwise DRF's SessionAuthentication runs the CSRF
    # origin check on a same-browser admin session and rejects the dev frontend.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
}

# Contract-first API (plan §4.1): the OpenAPI schema published at /api/schema/
# is the single source of truth the frontend MSW mocks are generated from.
SPECTACULAR_SETTINGS = {
    "TITLE": "HiveScale API",
    "DESCRIPTION": "Crowd-calibration guessing game — deal, guess, reveal.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# The cold-start and content-sanity enqueues are best-effort and fired from the
# request path, so a slow/absent broker must never block a web request. We don't
# read task results anywhere, so ignore them (no result-store round-trip), and
# cap broker connection attempts so a dead/unreachable redis fails in seconds.
CELERY_TASK_IGNORE_RESULT = True
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = False
CELERY_BROKER_TRANSPORT_OPTIONS = {"socket_connect_timeout": 2, "socket_timeout": 2}

# Gemini cold-start worker (WP-07). The key is absent in dev/CI; the worker is
# always faked in tests and the one real-API test is @external (run manually).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
# Celery per-task rate cap for Gemini calls. The free tier allows 5 requests per
# minute per model; keep the worker under that so backfills don't trip 429s.
# Celery syntax: "<n>/s", "<n>/m", or "<n>/h" (see the worker's ``rate_limit``).
GEMINI_RATE_LIMIT = os.environ.get("GEMINI_RATE_LIMIT", "5/m")
# Default cap for `manage.py backfill_ai_estimates` (per run). The free tier also
# has a *daily* request quota per model (e.g. 20/day for gemini-3.5-flash), so the
# backfill drips at most this many per run and is re-run daily. Set 0 for no cap.
GEMINI_BACKFILL_LIMIT = int(os.environ.get("GEMINI_BACKFILL_LIMIT", "20"))

# Player level required to unlock Thing/Scale submission (WP-11, plan §1.6).
CONTENT_SUGGEST_LEVEL = int(os.environ.get("CONTENT_SUGGEST_LEVEL", "10"))

# Level gates for the contribution features (plan §2.x). The dev/e2e stacks
# lower these so the flows are reachable without grinding to the real levels.
DAILY_WAVE_LEVEL = int(os.environ.get("CONTENT_DAILY_WAVE_LEVEL", "3"))
CONTENT_VOTE_LEVEL = int(os.environ.get("CONTENT_VOTE_LEVEL", "5"))
CONTENT_CHALLENGE_LEVEL = int(os.environ.get("CONTENT_CHALLENGE_LEVEL", "10"))
CONTENT_SCALE_LEVEL = int(os.environ.get("CONTENT_SCALE_LEVEL", "15"))
# Rounds a player must play on a day before that day's scale request is offered.
CONTENT_SCALE_MIN_ROUNDS = int(os.environ.get("CONTENT_SCALE_MIN_ROUNDS", "5"))

# Eligible answers before a pairing graduates to the human baseline (plan §1.5).
# Production is 15; the dev stack lowers it so the crowd histogram appears fast.
GRADUATION_MIN_ANSWERS = int(os.environ.get("GRADUATION_MIN_ANSWERS", "15"))

# Account-claim magic-link delivery: "echo" returns the token in the API
# response (dev/test); WP-11 adds real email delivery.
CLAIM_LINK_DELIVERY = os.environ.get("CLAIM_LINK_DELIVERY", "echo")
