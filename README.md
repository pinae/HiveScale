# Baseline Guesser

Guess where *society* places things on scales like `sophisticated ↔ overly complicated`.
Every guess is scored against the crowd — and doubles as a vote that sharpens the crowd
baseline. The game simultaneously builds an open (Thing × Scale → human distribution)
dataset with a parallel LLM-prediction track for AI-vs-human comparison.

Full design & roadmap: see `docs/baseline-guesser-plan.md` (work packages WP-01…WP-13).
This repository currently implements **WP-01: project skeleton & CI**.

## Stack

- **backend/** — Django 6 + Django REST Framework, PostgreSQL, Redis (Celery later); **uv** for
  dependency management (`pyproject.toml` + `uv.lock`), pytest, ruff
- **frontend/** — React 19 + TypeScript, Vite 6, Vitest 4 + Testing Library, Storybook 8, ESLint 10;
  **Yarn 4** via corepack (pinned by the `packageManager` field)
- **CI** — GitHub Actions: ruff + pytest via `uv run` (with Postgres service),
  eslint + tsc + vitest + Storybook build via `yarn` with `--immutable` installs

## Quickstart (docker-compose)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:5173 (shows a live backend-status indicator)
- Backend health: http://localhost:8000/api/health/ → `{"status": "ok", ...}`
- Django admin: http://localhost:8000/admin/

## Local development without Docker

Backend (sqlite fallback — zero services needed for the TDD loop):

```bash
cd backend
uv sync                        # creates .venv from uv.lock (dev group included)
uv run pytest                  # unit + API tests
uv run ruff check .            # lint
uv run python manage.py migrate && uv run python manage.py runserver
```

Frontend:

```bash
cd frontend
corepack enable                # activates the pinned yarn 4 automatically
yarn install --immutable
yarn test                      # vitest
yarn lint                      # eslint
yarn tsc -b                    # typecheck
yarn dev                       # http://localhost:5173 (proxies /api to :8000)
yarn storybook                 # component workshop on :6006
```

> Peer-dependency note: Storybook 8.6 ships a few transitive packages with missing
> peer declarations. `.yarnrc.yml` fixes these via `packageExtensions`, so a fresh
> `yarn install` completes with zero warnings — keep it that way when adding deps.

## TDD conventions (project-wide)

1. Red → green → refactor: no production code without a failing test first.
   The WP-01 git history demonstrates this — the health-endpoint and app-shell
   tests are committed (failing) before their implementations.
2. Tests marked `@pytest.mark.external` hit real third-party APIs and are
   excluded in CI (`-m "not external"`).
3. Every React component ships with Storybook stories for all visual states;
   interaction tests live in the stories (Storybook test-runner joins CI in WP-08/12).
4. Scheduler/scoring code must accept injected RNG/clock for determinism.

## Repository layout

```
backend/    Django project (config/) + core app (core/)
frontend/   Vite + React + TS app, .storybook/ config
docs/       planning document & work packages
.github/    CI workflows
```

## WP-01 acceptance checklist

- [x] `docker compose up` serves Django on :8000 and Vite on :5173 (compose healthchecks gate startup order)
- [x] Red→green demonstrated for both pytest and vitest (see git history)
- [x] ruff, eslint, tsc, vitest, pytest, Storybook build all green
- [x] README quickstart for clean machines (this file)

Implemented so far: **WP-01** (skeleton & CI), **WP-02** (`bglib.scoring` — pure scoring library, 98% branch coverage). Next: **WP-03 (domain models)** and **WP-04 (sessions)**.
