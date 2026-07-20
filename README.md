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

## Session API (WP-04) — curl demo

Anonymous identity is a signed, httpOnly cookie; the raw device token never
leaves the server, and anonymous players carry zero PII (email exists only on
the auth user after a claim).

```bash
J=/tmp/bg-cookies.txt

# 1. Start (or refresh) an anonymous session — creates a Player, sets the cookie
curl -s -c $J -X POST http://localhost:8000/api/session/
# {"player":{"level":1,"xp":0,"is_claimed":false},"created":true}

# 2. Same cookie -> same player
curl -s -b $J -c $J -X POST http://localhost:8000/api/session/
# {"player":{...},"created":false}

# 3. Profile
curl -s -b $J http://localhost:8000/api/me/

# 4. Claim the account (magic-link stub; "echo" delivery returns the token
#    directly in dev — WP-11 will email it instead)
TOKEN=$(curl -s -b $J -X POST -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}' \
  http://localhost:8000/api/session/claim/request/ | jq -r .claim_token)

# 5. Confirm: links the auth user, merges any prior history for that email,
#    and rotates the cookie (the old anonymous token stops working)
curl -s -b $J -c $J -X POST -H 'Content-Type: application/json' \
  -d "{\"claim_token\":\"$TOKEN\"}" \
  http://localhost:8000/api/session/claim/confirm/
# {"player":{"level":1,"xp":0,"is_claimed":true},"merged":false}
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

Implemented so far: **WP-01** (skeleton & CI), **WP-02** (`bglib.scoring`), **WP-03** (models & snapshots), **WP-04** (sessions & claiming), **WP-05** (pairing scheduler — 60/30/10 mix, blind deals, ~1.5 ms). Next: **WP-06 (round API)** and **WP-07 (Gemini cold-start worker)** — parallelizable.
