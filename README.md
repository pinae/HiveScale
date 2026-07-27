# Baseline Guesser

Guess where *society* places things on scales like `sophisticated ↔ overly complicated`.
Every guess is scored against the crowd — and doubles as a vote that sharpens the crowd
baseline. The game simultaneously builds an open (Thing × Scale → human distribution)
dataset with a parallel LLM-prediction track for AI-vs-human comparison.

Full design & roadmap: see `docs/baseline-guesser-plan.md` (work packages WP-01…WP-13).
Implemented so far: **WP-01…WP-10** — the full backend game loop (scoring, models,
sessions, scheduler, round API, Gemini cold-start worker) and a playable React
front end that boots straight into the deal → guess → reveal loop. See the status
list at the bottom.

## Stack

- **backend/** — Django 6 + Django REST Framework, PostgreSQL, Celery + Redis (async
  Gemini cold-start worker); **uv** for dependency management (`pyproject.toml` +
  `uv.lock`), pytest, ruff
- **frontend/** — React 19 + TypeScript, Vite 6, Vitest 4 + Testing Library, Storybook 8, ESLint 10;
  **Yarn 4** via corepack (pinned by the `packageManager` field)
- **CI** — GitHub Actions: ruff + pytest via `uv run` (with Postgres service),
  eslint + tsc + vitest + Storybook build via `yarn` with `--immutable` installs

## Quickstart (docker-compose)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:5173 (the playable game loop — deal, guess, reveal)
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

## Round API (WP-06) — curl demo

The core loop is a blind deal followed by a scored reveal. `GET /api/round/next/`
returns a signed `round_token` and **no** distribution data (the blind guarantee);
`POST /api/round/guess/` measures the response time server-side from the token,
scores the guess against the crowd snapshot *as it stood before the guess*, and
returns the reveal payload.

```bash
J=/tmp/bg-cookies.txt
curl -s -c $J -X POST http://localhost:8000/api/session/ >/dev/null

# 1. Deal a blind round (carries a signed token; no histogram/median)
curl -s -b $J http://localhost:8000/api/round/next/
# {"pairing_id":1,"thing":{"text":"Robotic lawnmower"},
#  "scale":{"left":"sophisticated","right":"overly complicated"},"round_token":"…"}

# 2. Submit a guess with that token -> score + crowd reveal
TOKEN=…   # the round_token from step 1
curl -s -b $J -X POST -H 'Content-Type: application/json' \
  -d "{\"round_token\":\"$TOKEN\",\"center\":53,\"width_left\":12,\"width_right\":12}" \
  http://localhost:8000/api/round/guess/
# {"source":"human","counted":true,
#  "score":{"total":924.4,"distance_points":583.6,"calibration_points":340.9,"covered_fraction":1.0},
#  "crowd":{"histogram":[…20 buckets…],"median":50.0,"q25":46.5,"q75":53.5,"n":20},
#  "percentile":50.0,"bimodal":false,"streak":{"hot":1},"player":{"xp":924,"level":1}}
```

Answers under the 1.5 s speed floor are stored but flagged `too_fast` — revealed for
fun, but they earn no xp/streak and never enter the baseline. Under-sampled pairings
return a `pioneer` payload (flat bonus + an optional clearly-labeled AI estimate)
instead; once 15 eligible answers exist the pairing graduates and the next guess is
scored against the human crowd.

**OpenAPI & mocks.** The schema is published at `/api/schema/` (drf-spectacular).
Frontend MSW handlers are generated from it: `cd frontend && yarn mocks:generate`
rebuilds `src/mocks/openapi.json` + `handlers.generated.ts`, and a vitest drift guard
fails if any endpoint loses its mock.

## AI cold-start worker (WP-07)

The first deal of a fresh pairing enqueues a Celery task that asks Gemini (official
`google-genai` SDK) for a provisional distribution, validated against a JSON schema and
stored as an `AIDistribution` — a research artifact that is **never** blended into the
human baseline. Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, default
`gemini-2.0-flash`) to enable it; without a key, or after repeated malformed responses,
the round falls back to pure pioneer mode. Gemini is always faked in tests, with one
`@external` smoke test that hits the real API and is excluded from CI.

## Game loop & component workshop (WP-08 / WP-09 / WP-10)

The app boots straight into the playable loop (`PlayScreen`): it deals a blind
round, the player places their guess with the one-thumb `WaveSlider` (drag the dot
to move, drag the ends to reshape, wheel/vertical-drag to resize), and submitting
animates the `RevealWave` payoff (crowd histogram, count-up score, percentile
stinger, outcome quips, bimodality + beat-the-bot variants). The next round is
preloaded during the reveal, and network failures drop into a retry state.

Every primitive also lives in Storybook with a story per state (idle, narrow, wide,
asymmetric, disabled, RTL, mobile, each reveal outcome): `cd frontend && yarn storybook`.
Component and loop behaviour is covered by Vitest, the loop flows against MSW mocks.

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

Implemented so far: **WP-01** (skeleton & CI), **WP-02** (`bglib.scoring`), **WP-03** (models & snapshots), **WP-04** (sessions & claiming), **WP-05** (pairing scheduler — 60/30/10 mix, blind deals), **WP-06** (round API: deal → guess → reveal, OpenAPI schema, generated MSW mocks), **WP-07** (Gemini cold-start worker + Celery), **WP-08** (React guess primitives), **WP-09** (`RevealWave` + score panel), **WP-10** (playable game loop screen: preloading, optimistic submit, too-fast toast, error/offline retry). Next: **WP-11 (meta layer — streaks, Daily Wave, stats, content submission)** and **WP-12 (Playwright e2e)**.
