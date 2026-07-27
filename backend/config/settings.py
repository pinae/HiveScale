"""Django settings for Societal Wavelength.

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

# DATABASE_URL (postgres://...) in docker-compose/CI/prod; sqlite fallback keeps
# `pytest` runnable with zero services for fast local TDD loops.
if os.environ.get("DATABASE_URL"):
    import dj_database_url

    DATABASES = {"default": dj_database_url.config(conn_max_age=60)}
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
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

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
    "TITLE": "Baseline Guesser API",
    "DESCRIPTION": "Crowd-calibration guessing game — deal, guess, reveal.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Gemini cold-start worker (WP-07). The key is absent in dev/CI; the worker is
# always faked in tests and the one real-API test is @external (run manually).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

# Account-claim magic-link delivery: "echo" returns the token in the API
# response (dev/test); WP-11 adds real email delivery.
CLAIM_LINK_DELIVERY = os.environ.get("CLAIM_LINK_DELIVERY", "echo")
