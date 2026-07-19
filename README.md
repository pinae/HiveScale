# Baseline Guesser

Guess where *society* places things on scales like `sophisticated ↔ overly complicated`.
Every guess is scored against the crowd — and doubles as a vote that sharpens the crowd
baseline. The game simultaneously builds an open (Thing × Scale → human distribution)
dataset with a parallel LLM-prediction track for AI-vs-human comparison.

Full design & roadmap: see `docs/baseline-guesser-plan.md` (work packages WP-01…WP-13).
This repository currently implements **WP-01: project skeleton & CI**.

## Stack

- **backend/** — Django 5 + Django REST Framework, PostgreSQL, Redis (Celery later), pytest, ruff
- **frontend/** — React 18 + TypeScript, Vite, Vitest + Testing Library, Storybook 8, ESLint
- **CI** — GitHub Actions: ruff + pytest (with Postgres service), eslint + tsc + vitest + Storybook build

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
pip install -r requirements-dev.txt
pytest                 # unit + API tests
ruff check .           # lint
python manage.py migrate && python manage.py runserver
```

Frontend:

```bash
cd frontend
npm install
npm test               # vitest
npm run lint           # eslint
npx tsc -b             # typecheck
npm run dev            # http://localhost:5173 (proxies /api to :8000)
npm run storybook      # component workshop on :6006
```

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

Next: **WP-02 (scoring library)** and **WP-03 (domain models)** — parallelizable.
