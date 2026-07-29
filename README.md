# HiveScale

Guess where *society* places things on scales like `sophisticated ↔ overly complicated`.
Every guess is scored against the crowd — and doubles as a vote that sharpens the crowd
baseline. The game simultaneously builds an open (Thing × Scale → human distribution)
dataset with a parallel LLM-prediction track for AI-vs-human comparison.

Full design & roadmap: see `docs/hivescale-plan.md` (work packages WP-01…WP-13).
Implemented so far: **WP-01…WP-11** — the full backend game loop (scoring, models,
sessions, scheduler, round API, Gemini cold-start worker) with the meta layer
(streaks, Daily Wave, stats/archetypes, gated content submission), and a playable
React front end that boots straight into the deal → guess → reveal loop. See the
status list at the bottom.

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
yarn playwright install chromium   # once, unless your env pre-installs it
yarn e2e                       # Playwright end-to-end suites (WP-12)
```

> **e2e (WP-12).** Two Playwright suites share one browser (`yarn e2e` runs both):
> `e2e/ui/` mocks the API at the network layer for fast UI mechanics (pointer
> drags, the reveal animation, reduced-motion); `e2e/stack/` runs the **real**
> Django backend — an isolated sqlite DB it reseeds on start, Gemini faked, no
> Redis — to prove the blind-deal guarantee, XP accumulation, the server-side
> speed floor, keyboard-only play, and the stats page. Both web servers start
> automatically; the stack suite needs `uv` (backend) on `PATH`.
>
> Playwright is pinned to the version whose bundled Chromium matches the
> container's pre-installed browser; on other machines run `yarn playwright
> install chromium` once. If `playwright install` has no build for your OS (e.g.
> Ubuntu 26.04), point it at a system Chromium instead:
> `PLAYWRIGHT_CHROMIUM_PATH=$(which chromium) yarn e2e`.

> Peer-dependency note: Storybook 8.6 ships a few transitive packages with missing
> peer declarations. `.yarnrc.yml` fixes these via `packageExtensions`, so a fresh
> `yarn install` completes with zero warnings — keep it that way when adding deps.

## Progression: how XP, multipliers, and levels work

The whole progression lives in `backend/core/leveling.py` (curve + multiplier
rules) and is applied centrally in `round_api.score_and_record`, so the round loop
and the Daily Wave award XP identically. All thresholds are tunable and the dev /
e2e stacks lower the level gates so the flows are reachable without grinding.

### Earning XP

XP is banked only on **counted** rounds (a guess slower than the 1.5 s speed floor;
too-fast rounds still reveal but earn nothing). Per round:

```
XP gained = round(visible_score × effective_multiplier)
```

- **`visible_score`** is the round's 0–1000 score (distance to the crowd median +
  interval calibration), or a flat **550 pioneer bonus** on an ungraduated pairing.
- **`effective_multiplier`** is the player's current multiplier — but **×1 until
  level 2**, so brand-new players always earn face value.
- **Thing challenges** (level 10) pay a flat **25,000 XP** — ten normal rounds at a
  ×5 multiplier — on top of the round loop. Pairing votes and scale requests are
  curation, not scored, so they grant no XP.

### The calibration multiplier (×1 → ×10)

From level 2 the multiplier rewards *calibrated* guessing rather than volume. After
each **graduated** ("human") round:

| Round outcome | Effect on the multiplier |
| --- | --- |
| Interval covers **≥ 70%** of the crowd | **+1** (capped at ×10) |
| Interval covers **< 70%** | **resets to ×1** |
| Crowd is **bimodal** ("society at war") | **unchanged** (neutral) |
| Pioneer round / too-fast | **unchanged** |

Because XP = score × multiplier, a long chain of well-calibrated rounds is worth
far more than the same number of sloppy ones — the intended path to level 5.

### The level curve

Cumulative XP per level widens sharply (`LEVEL_THRESHOLDS`). The L4→L5 jump
(40k → 500k) is the deliberate wall: at ~50 rounds/day and ×1 that's ~20 days, so
reaching level 5 inside a fortnight *requires* sustaining a high multiplier.

### What each level unlocks

| Level | Unlock |
| --- | --- |
| **1** | Normal play (deal → guess → reveal), Daily Wave, streaks, account claim |
| **2** | The calibration **XP multiplier** starts accruing (×1 → ×10) |
| **5** | **Pairing voting** — curate fun/interesting/boring/weird combos |
| **10** | **Thing challenges** — invent a ≤3-word thing (flat 25,000 XP reward) |
| **15** | **Scale requests** — craft a surprising new scale, once a day |

The backend reports these as an `unlocks` object on the session/reveal payloads,
so the front end gates each feature by what the server actually allows (letting the
dev/e2e stacks unlock features early just by lowering a threshold). When a round
carries the player across one of these levels, an explainer card (`LevelUpCard`)
pops up to introduce the new capability — fired only on genuine in-play crossings,
never on boot or an account claim, so a returning player isn't spammed.

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

Implemented so far: **WP-01** (skeleton & CI), **WP-02** (`bglib.scoring`), **WP-03** (models & snapshots), **WP-04** (sessions & claiming), **WP-05** (pairing scheduler — 60/30/10 mix, blind deals), **WP-06** (round API: deal → guess → reveal, OpenAPI schema, generated MSW mocks), **WP-07** (Gemini cold-start worker + Celery), **WP-08** (React guess primitives), **WP-09** (`RevealWave` + score panel), **WP-10** (playable game loop screen: preloading, optimistic submit, too-fast toast, error/offline retry), **WP-11** (meta layer: daily streaks + freezes, `generate_daily_wave` command + emoji share string, `/api/me/stats/` archetypes from a config file, level-gated content submission with an LLM sanity check + admin moderation queue, a stats page, the account-claim UI, and the playable Daily Wave — `/api/daily-wave/` play endpoints, an in-app slot-by-slot mode, and the Wordle-style share result), **WP-12** (Playwright e2e: a mocked-API UI suite for pointer
drags + the reveal animation, and a real-backend integration suite proving the
blind-deal guarantee, XP accumulation, the server-side speed floor, keyboard-only
play, the account-claim flow, Daily-Wave completion + share-to-clipboard, and the
stats page, pairing voting, thing challenges, scale requests). Next: wire e2e into CI and **WP-13 (research export)**.

### Progression & contribution (plan §2.x)

A real leveling curve now drives everything: XP → level via a sharply-widening
curve (`core/leveling.py`), and a calibration **XP multiplier** (×1–×10) that
climbs on ≥70%-covered graduated rounds, is neutral on bimodal rounds, and resets
on a poor one — so reaching level 5 needs sustained calibration, not just volume.
Level gates then unlock contribution:

- **Level 5 — pairing voting** *(done)*: `GET /api/vote/next/` + `POST /api/vote/`
  serve a thing+scale to judge (fun / interesting / boring / weird). A positive
  vote on a fresh combo promotes it to a real pairing; ≥80% negative votes retire
  an existing one (flagged, never re-suggested); admins can disable voting per
  pairing. In-app `VoteScreen`, gated by a backend `unlocks` flag.
- **Level 10 — thing challenges** *(done)*: `GET /api/challenge/next/` deals two
  random scales + a signed token; `POST /api/challenge/` accepts a ≤3-word thing
  that maxes the first scale and mins the second, files it (DRAFT → LLM sanity
  check) for the pool, and banks a flat bonus worth ten normal rounds at ×5
  (25,000 XP). In-app `ChallengeScreen`, gated by the backend `unlocks` flag.
- **Level 15 — scale requests** *(done)*: once a day (and only after a few rounds),
  `GET /api/scale-request/` picks a random thing and lists its most-popular existing
  scales as "already taken"; `POST /api/scale-request/submit/` files the player's
  surprising new scale (DRAFT → sanity check) and pairs it with the thing. In-app
  `ScaleRequestScreen`, gated by the backend `unlocks` flag plus the daily/rounds
  availability check.

Partial in WP-11 (APIs/services + tests done; wider UI still to come): direct
Thing/Scale submission has the gated API + moderation queue but not yet an in-app
form. Both previously-deferred WP-12 scenarios — account-claim-after-reveal and
Daily-Wave share-to-clipboard — are implemented and covered end to end.
