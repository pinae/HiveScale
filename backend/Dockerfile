# Single image for dev and production — the command is supplied by each compose
# file (dev: `uv run … runserver`; prod: `python manage.py … && gunicorn …`).
# Putting the uv virtualenv on PATH means bare `python`/`gunicorn`/`celery`
# resolve to it, so the prod command needs no `uv run` prefix and there is only
# one Dockerfile to keep in sync.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Install dependencies first (cached until the lockfile changes).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .

EXPOSE 8000

# Sane default for a bare `docker run`; compose overrides this per environment.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
