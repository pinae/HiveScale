# HiveScale

Guess where *society* places things on scales like `sophisticated ↔ overly complicated`.
Every guess is scored against the crowd — and doubles as a vote that sharpens the crowd
baseline. The game simultaneously builds an open (Thing × Scale → human distribution)
dataset with a parallel LLM-prediction track for AI-vs-human comparison.

The full backend game loop (scoring, models, sessions, scheduler, round API, Gemini
cold-start worker), the meta layer (streaks, Daily Wave, stats/archetypes, level-gated
content submission), a React front end that boots straight into the deal → guess →
reveal loop, an end-to-end Playwright suite, and the research export are all
implemented. The design & roadmap — including the original work-package breakdown —
lives in [`docs/hivescale-plan.md`](docs/hivescale-plan.md).

## Stack

- **backend/** — Django 6 + Django REST Framework, PostgreSQL, Celery + Redis (async
  Gemini cold-start worker); **uv** for dependency management (`pyproject.toml` +
  `uv.lock`), pytest, ruff
- **frontend/** — React 19 + TypeScript, Vite 6, Vitest 4 + Testing Library, Storybook 8, ESLint 10;
  **Yarn 4** via corepack (pinned by the `packageManager` field)
- **CI** — GitHub Actions: ruff + pytest via `uv run` (with Postgres service),
  eslint + tsc + vitest + Storybook build via `yarn` with `--immutable` installs

---

# How the game works

## The round loop & the blind deal

The core loop is a **blind deal** followed by a **scored reveal**:

- `GET /api/round/next/` deals a round — the Thing, the Scale's two poles, and a signed
  `round_token` — and **no distribution data** (the blind guarantee: you can't tell a
  fresh pairing from a well-sampled one before answering).
- `POST /api/round/guess/` measures your response time server-side from the token,
  scores your guess against the crowd snapshot **as it stood before your guess**, then
  returns the reveal.

Answers under the **1.5 s speed floor** are stored but flagged `too_fast` — revealed for
fun, but they earn no XP/streak and never enter the baseline. A pairing with too few
answers is a **pioneer** round (a flat bonus plus an optional, clearly-labelled AI
estimate); once 15 eligible answers exist the pairing **graduates** and is scored
against the human crowd. The scheduler mixes graduated / under-sampled / fresh pairings
and rotates so a large, mostly-unsampled pool still stays fun to play.

## The guess and the reveal

A player guesses a **whole distribution** — a mean and a left/right standard deviation —
which the one-thumb `WaveSlider` shapes as a **truncated split-normal bell**: drag the
dot left/right to move the mean, up/down to widen/narrow, drag the ends to reshape, or
wheel to resize. Because the two widths are the per-side σ, a lopsided guess renders a
lopsided bell; pushing toward an extreme clamps one side at the wall and leaves a
half-bell leaning on it — the natural shape of a decided crowd. The backend scores the
*same* truncated split-normal (`bglib.scoring.SplitNormalDist`), so you're scored on the
shape you see; off-scale tail mass is renormalized back in rather than lost.

The **reveal** (`RevealWave`) layers three things over one chart so you can compare
directly: the crowd's **mean placements** as bars, the crowd's **summed beliefs** (every
player's bell added up) as a smooth **orange** curve, and your own guess bell in
**teal** — plus a white mean line, a count-up score, a percentile stinger, outcome
quips, a "society at war" banner for bimodal crowds, and an optional "beat the bot"
comparison to the AI estimate. The next round is preloaded during the reveal; network
failures drop into a retry state.

Every primitive also lives in Storybook with a story per state (idle, narrow, wide,
asymmetric, disabled, RTL, mobile, each reveal outcome): `cd frontend && yarn storybook`.

## Player identity & coming back (no login)

Play is login-free by design — a player never needs a username or password — but their
XP, streaks, and history still follow them back. There are two layers.

### Anonymous identity (a signed device cookie)

Every player is a `Player` row whose identity is a random opaque token
(`device_token`, 16 bytes of `secrets`). The browser only ever holds a **signed** copy
of it in an httpOnly cookie — `bg_player` — set by `POST /api/session/`:

- **Signed**, so it can't be forged: it's `TimestampSigner(salt="hivescale.session").sign(token)`, verified server-side on every request (`core/sessions.py:resolve_player`). A tampered cookie is simply treated as "no session".
- **httpOnly**, so page scripts (and any XSS) can't read the token; **SameSite=Lax**; **Secure** whenever `DEBUG` is off (i.e. in production over HTTPS).
- **Long-lived**: `max_age` is ~13 months, and it's re-issued on each `POST /api/session/`, so an active player's identity effectively never expires. No PII is stored for an anonymous player — just a token and game stats.

So **coming back = same browser → same cookie → same player**, with zero friction. The
limits of this layer are the usual cookie limits: it's per-browser/per-device, and
clearing cookies or switching devices starts a fresh anonymous player. That's exactly
what the second layer fixes.

### Claiming an account by email (still no password)

At any point a player can tie their progress to an email so it survives cookie loss and
follows them across devices — via a magic link, never a password:

1. **`POST /api/session/claim/request/`** `{email}` issues a signed, 30-minute magic-link token (`salt="hivescale.claim"`). Delivery is pluggable via `CLAIM_LINK_DELIVERY`: `echo` (dev/test) returns the token in the response; production emails a link like `https://…/?claim=<token>`.
2. **`POST /api/session/claim/confirm/`** `{claim_token}` finishes it (`core/services.py:claim_player`):
   - **First claim of that email** → the current player is attached to a Django `User(username=email)`, its **device token is rotated** (the old cookie stops working), and a fresh cookie is set. `merged: false`.
   - **Email already has an account** (claimed earlier, e.g. on another device) → the two are **merged**: guesses (and their scores) move to the existing account, XP is summed, the higher level is kept, calibration counters add up, the anonymous row is deleted, and the response re-cookies for the account. `merged: true`.

On the front end this is the **"Save progress"** panel (`ClaimPanel`), and opening the
app from a magic link (`?claim=<token>`) auto-confirms via `useMagicLinkClaim`, which
then strips the token from the URL so a refresh can't replay a spent link.

## Daily Wave

The Daily Wave is the once-a-day, **same-for-everyone** appointment: a fixed set of
pairings and a shareable, Wordle-style emoji result. It **unlocks at level 3** — the
endpoints are gated (`CONTENT_DAILY_WAVE_LEVEL`, default 3; dev/e2e lower it) and the
header's "Daily" entry only appears once the backend `unlocks` flag says so.

### The shared set

`DailyWave` stores one row per calendar date with an ordered `pairing_ids` list.
`generate_daily_wave(day, size=10)` (`core/daily_wave.py`) picks `size` **active**
pairings using an RNG **seeded by the date** (`day.toordinal()`), so it is deterministic
and idempotent — every player who reads a given date sees the *same pairings in the same
order*. It's created by `manage.py generate_daily_wave` (e.g. from a nightly cron) or
lazily on the first `GET /api/daily-wave/` of the day.

### Playing it

- **`GET /api/daily-wave/`** returns today's progress plus the next *blind* slot to
  answer (`thing`, `scale`, and a signed `wave_token` — never any distribution, the same
  blind guarantee as the round loop) and, when finished, the share string.
- **`POST /api/daily-wave/guess/`** scores one slot by **reusing the round scorer**
  (`round_api.score_and_record`), so a wave slot behaves exactly like a normal round: the
  1.5 s speed floor, scoring against the pre-guess crowd snapshot, the human-vs-pioneer
  split, and XP/multiplier/streak folding all apply. Each answer is recorded as a
  `DailyWaveEntry` (unique per player + wave + slot), so the wave is answered **once, in
  order**.

### The shareable result

Each slot's visible score maps to a grade emoji, best-first:

| Score (0–1000) | Emoji | Meaning |
| --- | --- | --- |
| ≥ 800 | 🎯 | bullseye |
| ≥ 500 | 🌊 | rode the wave |
| ≥ 250 | 🌫️ | foggy |
| < 250 | 🥶 | cold |

When every slot is answered the wave is `completed` and `share_string` is filled in:

```
HiveScale 2026-07-28
🎯🌊🌊🌫️🎯🌊🥶🌊🎯🌊
6120 pts · 🔥4
```

(the `· 🔥N` daily-streak suffix appears only when the streak is non-zero). The front
end's `DailyWaveResult` copies this exact text to the clipboard — spoiler-free, since it
shows grades but never the answers.

## Player contributions & curation

Higher levels let players grow and curate the content pool. Each feature is gated by a
backend `unlocks` flag (so the dev/e2e stacks can open them early by lowering a
threshold), and reaching the level pops an explainer card:

- **Level 5 — pairing voting.** `GET /api/vote/next/` serves a thing+scale to judge (fun
  / interesting / boring / weird); `POST /api/vote/` records it. A positive vote on a
  fresh combo promotes it to a real pairing; ≥80% negative votes retire an existing one
  (flagged, never re-suggested); admins can disable voting per pairing.
- **Level 10 — thing challenges.** `GET /api/challenge/next/` deals two random scales + a
  signed token; `POST /api/challenge/` accepts a ≤3-word thing that maxes the first scale
  and mins the second, files it (DRAFT → LLM sanity check) for the pool, and banks a flat
  bonus worth ten normal rounds at ×5 (**25,000 XP**).
- **Level 15 — scale requests.** Once a day (and only after a few rounds),
  `GET /api/scale-request/` picks a random thing and lists its most-popular existing
  scales as "already taken"; `POST /api/scale-request/submit/` files the player's
  surprising new scale (DRAFT → sanity check) and pairs it with the thing.

Player-submitted Things and Scales run through an LLM sanity check and land in an admin
moderation queue before going live. `manage.py pair_all` idempotently creates the full
active Thing × Scale cross-product when you want to seed the pool.

## AI cold-start (Gemini)

Fresh pairings that have no trustworthy human baseline yet get a *provisional* AI
estimate from Gemini. It's asked for a societal distribution of the Thing on the Scale,
validated against a JSON schema, and stored as an `AIDistribution` — a research artifact
that is **never** blended into the human baseline.

### Getting a Gemini API key

1. Sign in at **[Google AI Studio](https://aistudio.google.com/)** with a Google account.
2. Open **"Get API key" → "Create API key"** (it can be attached to a Google Cloud
   project for billing/quota; a free tier exists with low rate limits). ⚠️ The free tier
   caps **daily** requests per model (e.g. **20/day** for `gemini-3.5-flash`) — enough to
   trickle estimates in, but not to backfill a large pool. See *collecting estimates* below.
3. Copy the key — it's a secret, so treat it like a password (never commit it).

### Configuring it

| Variable | Purpose | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Your AI Studio key. **Empty = feature off** (fresh pairings just stay in pioneer mode). | `""` |
| `GEMINI_MODEL` | Which model to call. | `gemini-3.5-flash` |
| `GEMINI_RATE_LIMIT` | Per-task Celery cap on Gemini calls (`n/s`, `n/m`, `n/h`). Keep it at or under your tier's quota. | `5/m` |
| `GEMINI_BACKFILL_LIMIT` | Default per-run cap for `backfill_ai_estimates` (0 = no cap). Matches the free-tier daily quota. | `20` |

In dev, put `GEMINI_API_KEY=…` in your `.env`; in production it comes from your secret
store (e.g. an Ansible vault), never a checked-in template.

### Keeping the account unblocked

The design keeps call volume low and bursts controlled:

- **Only fresh pairings trigger a call** — not every round. Once a pairing has an
  estimate (or a human baseline), it's never queried again.
- **One call per pairing, idempotent.** `generate_ai_distribution` is keyed on
  `(pairing, model, PROMPT_VERSION)` and returns the stored row without calling if it
  already exists — so retries and re-runs never duplicate calls.
- **Off the request path, rate-bounded by the worker.** Calls run on the Celery worker.
  The `estimate_distribution` task carries a **`rate_limit`** (`GEMINI_RATE_LIMIT`,
  default `5/m`) so the worker paces itself under the free tier's per-minute quota no
  matter how many tasks are queued, and `--concurrency` caps how many run at once.
- **429s stop, they don't retry.** Transient/malformed responses are retried up to 3
  times with **exponential backoff** (`2^attempt` seconds), but a `429 RESOURCE_EXHAUSTED`
  (quota) short-circuits to pioneer mode immediately — the API's `retryDelay` is tens of
  seconds, far longer than our backoff, so fast-retrying would only burn more budget.
- **A 429 pauses the whole worker, it doesn't just skip one pairing.** A quota rejection
  means the *account* is out of budget, so the worker reads the error's reset hint and
  arms a process-wide **cooldown**: queued tasks short-circuit to pioneer mode without
  calling the API until the quota resets, instead of each firing a doomed request. It
  tells a *daily* quota (reset at midnight Pacific) from a transient *per-minute* cap
  (waits the `retryDelay`, ~30–60 s). The cooldown is in-memory per worker process, so
  restarting the worker clears it and a single fresh probe re-arms it if quota is spent.
- **Mind the *daily* cap.** `GEMINI_RATE_LIMIT` paces *per-minute* bursts, but the free
  tier's binding constraint is a **daily** request quota per model (e.g. 20/day). Pace
  bulk work with `backfill_ai_estimates --limit` rather than per-minute settings; for a
  real content pool, enable billing.
- **Structured output**: requests set `response_mime_type: application/json` and the
  reply is schema-validated (20-bucket histogram, ordered quantiles) before it's trusted.
- **Best-effort enqueue**: the request-path enqueue fails fast (≈50 ms) if the broker is
  down, so a Redis outage never stalls a deal.

### Collecting estimates for the whole pool

- **Lazily, on demand:** the first time a fresh pairing is *dealt*, the round API enqueues
  a cold-start task; the worker stores its `AIDistribution`. So estimates accumulate
  naturally as players encounter new pairings.
- **Proactively, in bulk:** after a large import (e.g. `pair_all`), run
  **`manage.py backfill_ai_estimates`** to enqueue an estimate for every active pairing
  that doesn't have one yet (`--all-statuses` to include drafts). It only *enqueues* — the
  worker paces the actual calls. On the free tier it **drips**: each run enqueues at most
  `GEMINI_BACKFILL_LIMIT` (20), is idempotent, and reports how many pairings still need
  one, so you re-run it once a day. On a paid tier, pass `--limit 0` to lift the cap.

Gemini is always faked in tests via a small client protocol (`FakeGeminiClient`); the one
`@external` test that hits the real API is excluded from CI.

## Research export & statistics

The whole point of the game is the dataset it produces: where a representative crowd
places everyday **Things** on bipolar **Scales** (0–100). Its natural shape is a
**named-dimension embedding** — a Thing × Scale matrix of crowd medians, where every axis
is a human-readable Scale (train e.g. an embedding model whose dimensions *are* the
scales).

### Exporting the dataset

```bash
uv run python manage.py export_dataset ./dataset --min-n 15
```

Writes a small, versioned bundle (CSV + JSON, no extra dependencies):

| File | What it is |
| --- | --- |
| `embedding_matrix.csv` | The headline artifact — Things (rows) × Scales (columns), cell = crowd median. |
| `pairings.csv` | Per-pairing stats: median, q25/q75, IQR, std, shape, bimodality (dip ratio), AI divergence. |
| `histograms.csv` | The full 20-bucket crowd distribution per pairing. |
| `scale_correlations.csv` | Pearson *r* between Scales over shared Things. |
| `things.csv` / `scales.csv` | Dimension metadata. |
| `dataset_card.md` | Fields, licensing intent, and known biases. |
| `manifest.json` | Version, counts, and the filters used. |

- **Aggregate-only, PII-free by construction.** The export reads `DistributionSnapshot`
  rows, built from `eligible_guesses` — quality-flagged, too-fast, and zero-weighted
  answers are already excluded, and no player identifiers, tokens, emails, or per-answer
  rows are ever written.
- `--min-n` sets the minimum eligible answers a pairing needs to be included (default 15).
- `--parquet` also writes Parquet copies (needs `pyarrow`; omit it for CSV/JSON only).

### Statistics in the Django admin

The admin has a read-only **Research statistics** page (under the `core` app) rendered as
inline SVG — no matplotlib, no JS, no external assets:

- **Scale correlations** — a colour heatmap (red = move together, blue = opposite) plus a
  ranked table, so you can see which Scales track each other across Things.
- **🎯 Tightest distributions** — pairings society most agrees on (narrow IQR).
- **⚔️ Society is at war** — genuinely bimodal pairings (two opinion camps), via the same
  `detect_bimodality` the game uses, deepest valley first.
- **🤖 AI blind spots** — pairings where the LLM prior's median is furthest from the
  crowd, with the AI distribution overlaid (red line) on the crowd histogram.

Each `DistributionSnapshot` also shows its shape (`🎯 tight` / `🌫️ wide` / `⚔️ divided`)
in the list and an inline distribution chart on its detail page.

---

# Progression: XP, multipliers, and levels

The whole progression lives in `backend/core/leveling.py` (curve + multiplier rules) and
is applied centrally in `round_api.score_and_record`, so the round loop and the Daily
Wave award XP identically. All thresholds are tunable, and the dev / e2e stacks lower the
level gates so the flows are reachable without grinding.

## Earning XP

XP is banked only on **counted** rounds (a guess slower than the 1.5 s speed floor;
too-fast rounds still reveal but earn nothing). Per round:

```
XP gained = round(visible_score × effective_multiplier)
```

- **`visible_score`** is the round's 0–1000 score — a blend of two *distribution matches*
  (below) — or a flat **550 pioneer bonus** on an ungraduated pairing.
- **`effective_multiplier`** is the player's current multiplier — but **×1 until level 2**,
  so brand-new players always earn face value.
- **Thing challenges** (level 10) pay a flat **25,000 XP** — ten normal rounds at a ×5
  multiplier — on top of the round loop. Pairing votes and scale requests are curation,
  not scored, so they grant no XP.

## Scoring: two ways to be right

A graduated round scores your split-normal bell against the crowd two ways, each an
*overlap* in 0–1 (`1 = identical`, `0 = disjoint`):

- **Means match** — overlap with the distribution of other players' **mean** placements
  (the reveal's bar chart). Did you find where people land?
- **Belief match** — overlap with the crowd's **summed full guesses** (every player's own
  bell added up — the reveal's orange curve). Did you match what people *believe*,
  uncertainty and all?

The visible score is `ROUND_MAX_POINTS × (w_means·means_match + w_belief·belief_match) / (w_means + w_belief)`.
The two weights (`XP_MEANS_WEIGHT`, `XP_BELIEF_WEIGHT`, both `0.5` by default) and
`ROUND_MAX_POINTS` (1000) are settings, so the balance is tunable without a code change.
Matching the tight means and the wide belief pulls in opposite directions, so a good
guess strikes a balance.

## The calibration multiplier (×1 → ×10)

From level 2 the multiplier rewards *calibrated* guessing rather than volume. After each
**graduated** ("human") round:

| Round outcome | Effect on the multiplier |
| --- | --- |
| **Good match** — either component clears `GOOD_MATCH_THRESHOLD` (0.6) | **+1** (capped at ×10) |
| Neither component clears it | **resets to ×1** |
| Crowd is **bimodal** ("society at war") | **unchanged** (neutral) |
| Pioneer round / too-fast | **unchanged** |

You keep your multiplier if *either* kind of guess was good, so both skills are worth
cultivating. Because XP = score × multiplier, a long chain of well-matched rounds is
worth far more than the same number of sloppy ones — the path to level 5.

## The level curve

Cumulative XP per level widens sharply (`LEVEL_THRESHOLDS`). The L4→L5 jump (40k → 500k)
is the deliberate wall: at ~50 rounds/day and ×1 that's ~20 days, so reaching level 5
inside a fortnight *requires* sustaining a high multiplier.

## What each level unlocks

| Level | Unlock |
| --- | --- |
| **1** | Normal play (deal → guess → reveal), streaks, account claim |
| **2** | The calibration **XP multiplier** starts accruing (×1 → ×10) |
| **3** | **Daily Wave** — the daily shared set + shareable emoji result |
| **5** | **Pairing voting** — curate fun/interesting/boring/weird combos |
| **10** | **Thing challenges** — invent a ≤3-word thing (flat 25,000 XP reward) |
| **15** | **Scale requests** — craft a surprising new scale, once a day |

The backend reports these as an `unlocks` object on the session/reveal payloads, so the
front end gates each feature by what the server actually allows. When a round carries the
player across one of these levels, an explainer card (`LevelUpCard`) pops up — fired only
on genuine in-play crossings, never on boot or an account claim, so a returning player
isn't spammed.

---

# Development

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
yarn e2e                       # Playwright end-to-end suites
```

> **End-to-end.** Two Playwright suites share one browser (`yarn e2e` runs both):
> `e2e/ui/` mocks the API at the network layer for fast UI mechanics (pointer drags, the
> reveal animation, reduced-motion); `e2e/stack/` runs the **real** Django backend — an
> isolated sqlite DB it reseeds on start, Gemini faked, no Redis — to prove the blind-deal
> guarantee, XP accumulation, the server-side speed floor, keyboard-only play, and the
> stats page. Both web servers start automatically; the stack suite needs `uv` on `PATH`.
>
> Playwright is pinned to the version whose bundled Chromium matches the container's
> pre-installed browser; on other machines run `yarn playwright install chromium` once. If
> `playwright install` has no build for your OS (e.g. Ubuntu 26.04), point it at a system
> Chromium instead: `PLAYWRIGHT_CHROMIUM_PATH=$(which chromium) yarn e2e`.

> Peer-dependency note: Storybook 8.6 ships a few transitive packages with missing peer
> declarations. `.yarnrc.yml` fixes these via `packageExtensions`, so a fresh `yarn
> install` completes with zero warnings — keep it that way when adding deps.

## Session API — curl demo

Anonymous identity is a signed, httpOnly cookie; the raw device token never leaves the
server, and anonymous players carry zero PII (email exists only on the auth user after a
claim).

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
#    directly in dev — production emails it instead)
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

## Round API — curl demo

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
#  "score":{"total":712.0,"means_match":0.74,"belief_match":0.68,"good_match":true},
#  "crowd":{"histogram":[…20 buckets…],"belief_histogram":[…20 buckets…],
#           "median":50.0,"q25":46.5,"q75":53.5,"n":20},
#  "percentile":50.0,"bimodal":false,"streak":{"hot":1},"player":{"xp":712,"level":1}}
```

**OpenAPI & mocks.** The schema is published at `/api/schema/` (drf-spectacular). Frontend
MSW handlers are generated from it: `cd frontend && yarn mocks:generate` rebuilds
`src/mocks/openapi.json` + `handlers.generated.ts`, and a vitest drift guard fails if any
endpoint loses its mock.

## Testing conventions

1. Red → green → refactor: no production code without a failing test first.
2. Tests marked `@pytest.mark.external` hit real third-party APIs and are excluded in CI
   (`-m "not external"`).
3. Every React component ships with Storybook stories for all visual states; component
   and loop behaviour is covered by Vitest (loop flows against MSW mocks).
4. Scheduler/scoring code must accept injected RNG/clock for determinism.

Backend tests are grouped into logical packages under `backend/core/tests/` — `platform/`,
`gameplay/`, `ai/`, `daily_wave/`, `contributions/`, and `research/` — plus the pure
scoring library's tests in `backend/bglib/tests/`. Frontend tests are colocated next to
each component.

## Repository layout

```
backend/    Django project (config/) + core app (core/); pure scoring lib in bglib/
frontend/   Vite + React + TS app, .storybook/ config, e2e/ Playwright suites
docs/       planning document & work packages
.github/    CI workflows
```

---

# Deployment

The two images are built from the repo and put behind an edge proxy (Traefik), which
terminates TLS; the app containers speak plain HTTP.

- **backend/Dockerfile** — one image for dev and prod. It bakes the `uv`-managed venv onto
  `PATH` and runs `gunicorn config.wsgi:application`. The **same image** runs the Celery
  worker (`celery -A config worker`) for the Gemini cold-start.
- **frontend/Dockerfile.prod** — a multi-stage build: `yarn build` the Vite app, then
  serve the static `dist/` with nginx (HTTP-only, config baked in) that proxies `/api`,
  `/admin`, `/accounts`, `/static/`, and `/media/` to the backend.

### Key environment variables

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Django secret (required in prod). |
| `DJANGO_DEBUG` | `0` in production (turns on `Secure`/`HttpOnly` cookies, etc.). |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | Your public host(s). |
| `DATABASE_URL` *(or* `DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_HOST`/`DB_PORT`*)* | Postgres connection. Falls back to sqlite when unset. |
| `REDIS_URL` | Celery broker (e.g. `redis://redis:6379/0`). |
| `DJANGO_SECURE_PROXY_SSL_HEADER=1` | Trust `X-Forwarded-Proto` from the edge proxy so Django knows requests are HTTPS. |
| `DJANGO_STATIC_ROOT`, `DJANGO_MEDIA_ROOT` | Where `collectstatic` writes and uploads live. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_RATE_LIMIT`, `GEMINI_BACKFILL_LIMIT` | AI cold-start (see above). |
| `XP_MEANS_WEIGHT`, `XP_BELIEF_WEIGHT`, `ROUND_MAX_POINTS`, `GOOD_MATCH_THRESHOLD` | Scoring/XP balance. |
| `CONTENT_DAILY_WAVE_LEVEL`, `CONTENT_VOTE_LEVEL`, `CONTENT_CHALLENGE_LEVEL`, `CONTENT_SCALE_LEVEL` | Level gates for the meta features. |

Secrets belong in your secret store (e.g. an Ansible vault via a `service_cfg` map), never
in a checked-in compose template.

### Deploy steps

1. Build & push the backend and frontend images.
2. Run `python manage.py migrate` — this also runs the data migration that backfills the
   summed-belief histogram onto existing snapshots, and `collectstatic` for static assets.
3. Start the web (gunicorn), worker (celery), Redis, and Postgres services.
4. Point Traefik at the frontend (public) and let it reach the backend over the internal
   network.

To (re)generate the daily set and AI estimates on a schedule, run `manage.py
generate_daily_wave` (nightly) and `manage.py backfill_ai_estimates` (daily, respecting
the free-tier drip) from a cron or a scheduled task.
