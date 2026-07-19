# Societal Wavelength — Planning Document

*A crowd-calibration guessing game that doubles as an alignment-dataset factory.*

---

## Part 1 — Concept & Game Design

### 1.1 One-paragraph pitch

Players are shown a **Thing** ("robotic lawnmower") and a **Scale** ("sophisticated ↔ overly complicated"). They place the Thing on the scale and express how confident they are by widening or narrowing an interval around their guess. Points are awarded for how well their guess matches the *distribution of everyone else's answers* — the "societal baseline." Every guess is simultaneously a vote that sharpens that baseline for future players. Over time the game harvests a dense matrix of (Thing × Scale → human distribution) judgments, alongside a parallel matrix of LLM-generated distributions, giving a direct, ever-growing benchmark of how well AI models predict human semantic and normative intuitions.

### 1.2 Core loop

1. **Draw** — the server deals a Thing × Scale pairing.
2. **Guess** — the player drags a marker onto a continuous 0–100 scale and stretches a confidence interval around it. (Optionally: skewed intervals, i.e. asymmetric left/right widths.)
3. **Reveal** — the crowd distribution animates into view under the player's guess. This is the emotional payoff moment and must be *juicy*.
4. **Score** — points based on distributional fit + calibration.
5. **Next** — one tap to the next pairing. Target round time: **under 15 seconds**.

### 1.3 What the guess actually is (data model of a single answer)

A guess is a small parametric distribution, not a point:

- `center` ∈ [0, 100]
- `width_left`, `width_right` (interval half-widths; symmetric by default, asymmetric unlockable)

Internally this is treated as a (possibly skewed) truncated-normal or triangular distribution. That makes every answer usable both as:

- a **sample** contributing to the crowd distribution (use `center`, weight optionally by inverse width), and
- a **forecast** that can be scored with a proper scoring rule against the crowd distribution.

### 1.4 Scoring

Two layers — a *visible* layer that is instantly intuitive, and a *hidden* layer that is statistically sound and drives long-term rankings.

**Visible score (per round, 0–1000 points):**

- Distance component: how close `center` is to the crowd median (mapped through a generous curve so near-misses still feel rewarded).
- Calibration component: bonus if the crowd's interquartile range falls inside the player's interval, scaled down as the interval gets wider — tight *and* right pays most. This is the "poker" tension: narrow interval = high risk, high reward.
- Streak multiplier (see fun section).

**Hidden score (per player, running):**

- CRPS (continuous ranked probability score) of the player's forecast distribution against the empirical crowd distribution. CRPS is a proper scoring rule: the optimal strategy is to honestly report your belief, which is exactly the incentive we want for data quality.
- A rolling calibration curve (did their 50% intervals contain the crowd median ~50% of the time?) which powers badges and unlocks.

**Why match-the-crowd doesn't ruin the data:** players always answer *blind* — they never see the current distribution before committing. So each answer is an independent estimate of "where society would put this," which is precisely the signal we want. The Keynesian-beauty-contest incentive is a feature here, not a bug: we're measuring perceived societal consensus, and the guess *is* the vote.

### 1.5 Cold start: new pairings and the LLM

When a pairing has fewer than `N_min` human answers (e.g. 15), there is no trustworthy crowd distribution. Handling:

1. On first draw of a fresh pairing, the backend asks the **Gemini API** to produce a distribution estimate (median, IQR, and a coarse 10-bucket histogram, plus a one-line rationale). This is stored as an `AIDistribution`, versioned by model name and prompt version.
2. The AI distribution is **never blended into the human baseline**. It is used only to (a) give provisional feedback in the reveal (clearly labeled "AI estimate — be one of the first humans to weigh in!") and (b) build the AI-vs-human comparison dataset.
3. Players answering under-sampled pairings get a flat **Pioneer Bonus** instead of accuracy points, so nobody is punished for the missing baseline and nobody is incentivized to chase the AI's opinion.
4. Once `N_min` human answers exist, the pairing "graduates": scoring switches to the human distribution, and the frozen AI estimate becomes a permanent comparison record.

This yields the research artifact for free: for every graduated pairing we have *(AI prior, human posterior)* and can compute divergence metrics (Wasserstein distance between AI and human histograms, median offset, IQR ratio) across thousands of concept × dimension combinations.

### 1.6 Content growth: player-generated Things and Scales

- Experienced players (level-gated + calibration-gated) unlock **"Suggest a Thing"**, later **"Suggest a Scale"**.
- Submissions go through: profanity/PII filter → LLM sanity check (is it a real, broadly-known concept? is the scale a meaningful bipolar dimension?) → light moderation queue.
- The pairing scheduler mixes: (a) under-sampled pairings that need data, (b) well-sampled pairings that are fun and reliable, (c) a trickle of brand-new content. Exploration/exploitation balance ≈ 30/60/10.
- Creators earn royalties: a small point kickback every time their Thing/Scale is played — a strong retention hook and a self-feeding content pipeline.

### 1.7 Data-quality safeguards

- Blind answering (already covered).
- Speed floor: answers submitted in < 1.5 s are stored but flagged and excluded from the baseline.
- Outlier robustness: baseline uses all answers, but scoring targets (median/IQR) are robust statistics; no trimming needed early on.
- Troll detection: players whose answers are persistently near-uniform-random (high CRPS across easy, low-variance pairings) get down-weighted in the baseline silently — never blocked from playing.
- Distribution snapshots: the baseline shown/scored against is a cached snapshot recomputed periodically, so a burst of coordinated votes can't instantly warp scoring.

---

## Part 2 — What makes it fun (and how to maximize guesses per player)

The metric to optimize is **guesses per day**, which decomposes into *session length* × *sessions per day* × *retention*. Suggestions grouped accordingly.

### 2.1 Make each round intrinsically delicious (session length)

1. **The Reveal is the product.** Animate the crowd histogram rising like a wave under the player's marker, with their interval glowing green where it overlaps the crowd mass. Add a percentile stinger: *"Closer to the hive mind than 83% of players."* Sound + haptic tick on score count-up. This 2-second moment is why people play "one more."
2. **A slider that feels great.** Magnetic, springy drag physics; the interval stretches with a rubber-band feel; subtle haptics at the scale's midpoint and ends. Usability rule: the entire round is playable with one thumb.
3. **Risk dial tension.** Because a narrow interval multiplies points, every round contains a micro-gamble: "I *know* where society puts 'pineapple pizza' on disgusting↔delightful… do I dare go tight?"
4. **Bimodal drama.** Some pairings split society (e.g. "cryptocurrency" on innovative↔scam). Detect bimodality and celebrate it in the reveal: *"Society is at war over this one!"* with the two camps visualized. These become shareable moments.
5. **Flavor micro-copy.** Every reveal gets one procedurally chosen quip based on outcome class (nailed it / confidently wrong / cowardly wide / contrarian). Confidently wrong deserves the funniest lines — losing must be entertaining.

### 2.2 Reasons to come back (sessions per day, retention)

6. **Daily Wave** — a fixed set of 10 pairings, identical for everyone, once per day, with a Wordle-style shareable result made of emoji (🌊🎯🌊🌫️…). Free viral marketing and a daily appointment.
7. **Streaks** — daily-play streak plus in-session hot streaks (3 good rounds → multiplier). Streak-freeze item earned by playing, not paid.
8. **Calibration identity.** Long-term stats page framed as a personality: "You are an **Oracle** (well-calibrated, tight intervals)" vs. "**Maverick** (accurate but contrarian)" vs. "**Diplomat** (wide and safe)." People retake personality tests forever; this one updates live.
9. **Leaderboards that don't demoralize.** Weekly leagues of ~30 players (Duolingo-style promotion/relegation) instead of one global board a newcomer can never climb.
10. **Creator status.** Unlocking "Suggest a Thing" at level ~10 is the mid-game carrot; seeing *your* Thing played 5,000 times (with royalties) is the end-game one.

### 2.3 Frictionlessness (funnel)

11. **Zero-login first session.** Anonymous device ID; you're guessing within 5 seconds of page load. Account claim (email/OAuth) is offered *after* the first score reveal, when motivation peaks, to save streak + stats.
12. **Instant next round.** Preload the next pairing during the reveal animation. No spinners, ever.
13. **PWA + mobile-first.** Installable, offline-queueable guesses, push for Daily Wave (opt-in).

### 2.4 Human vs. AI as a fun engine (unique to this game)

14. **"Beat the Bot" reveal layer.** After the human baseline appears, optionally overlay where the AI had guessed: *"You beat Gemini by 12 points on this one."* Humans love out-guessing the machine, and it advertises the dataset's purpose honestly.
15. **Weekly "AI blind spots" digest** — an auto-generated post/screen showing the pairings where AI and society diverged most this week. Extremely shareable, doubles as public research output.

### 2.5 Anti-fun traps to avoid

- Don't punish exploration: no point *loss*, only smaller gains.
- Don't show global rank to newcomers.
- Don't make Pioneer rounds feel like unpaid labor — the flat bonus should be slightly *above* the expected value of a normal round.
- Don't let sessions be hijacked by moderation prompts or rating dialogs.

---

## Part 3 — Architecture Overview

### 3.1 Stack

- **Backend:** Django 5 + Django REST Framework, PostgreSQL, Celery + Redis (async Gemini calls, snapshot recomputation), `pytest-django`.
- **Frontend:** React 18 + TypeScript, Vite, Zustand (state), TanStack Query (API), Framer Motion (reveal animations), Storybook 8 (component workshop + interaction tests), Playwright (e2e).
- **LLM:** Gemini API via the official `google-genai` Python SDK, called only from Celery workers, never from request threads. Responses validated against a JSON schema; failures retried then fall back to "pure pioneer mode" (no provisional feedback).
- **Auth:** anonymous session with signed device token → optional upgrade to email/OAuth account, preserving history.

### 3.2 Core domain models

| Model | Key fields | Notes |
|---|---|---|
| `Thing` | text, slug, status, created_by, language | status: draft/active/retired |
| `Scale` | left_label, right_label, slug, status, created_by | bipolar, continuous 0–100 |
| `Pairing` | thing FK, scale FK, status, n_answers, graduated_at | unique (thing, scale) |
| `Guess` | pairing FK, player FK, center, width_left, width_right, response_ms, quality_flags, created_at | immutable |
| `DistributionSnapshot` | pairing FK, histogram (JSON, 20 buckets), median, q25, q75, n, computed_at | cached scoring target |
| `AIDistribution` | pairing FK, model_name, prompt_version, histogram, median, q25, q75, rationale, created_at | never mixed into snapshots |
| `Player` | user/device token, level, xp, calibration_stats (JSON), weight | weight for silent down-weighting |
| `RoundScore` | guess FK, visible_points, crps, components (JSON) | reproducible scoring record |
| `DailyWave` | date, ordered pairing list | same for all players |

### 3.3 Key API endpoints (DRF)

- `POST /api/session/` — create/refresh anonymous session.
- `GET /api/round/next/` — scheduler deals a pairing (exploration/exploitation mix); response contains no distribution data (blind guarantee).
- `POST /api/round/guess/` — submit guess → returns score + snapshot (or AI provisional + pioneer bonus).
- `GET /api/daily-wave/` / `POST /api/daily-wave/guess/`
- `GET /api/me/stats/` — calibration curve, archetype, streaks.
- `POST /api/content/things/`, `POST /api/content/scales/` — gated submissions.
- `GET /api/research/divergence/` — AI-vs-human metrics (staff/API-key only at first).

### 3.4 Scoring service (pure Python module, no Django imports)

`scoring.py` exposes pure functions — trivially unit-testable and reusable in analysis notebooks:

- `guess_to_distribution(center, wl, wr) -> ParamDist`
- `visible_score(guess, snapshot) -> ScoreBreakdown`
- `crps(guess_dist, snapshot_histogram) -> float`
- `calibration_update(stats, guess, snapshot) -> stats`
- `detect_bimodality(histogram) -> BimodalityReport`

---

## Part 4 — Implementation Plan (Test-Driven Development)

### 4.1 TDD ground rules for this project

1. **Red → Green → Refactor** at every layer. No production code without a failing test first.
2. **Test pyramid:** pure-function unit tests (scoring, scheduler) ≫ API tests (DRF `APIClient`) ≫ component tests (Storybook interaction tests via `@storybook/test`) ≫ e2e (Playwright, happy paths + the blind-guarantee invariant).
3. **Contract-first API:** OpenAPI schema generated from DRF serializers; frontend mocks (MSW) are generated from the same schema so Storybook and unit tests never drift from the backend.
4. **Gemini is always faked in tests.** A `FakeGeminiClient` returns canned schema-valid payloads; one thin integration test (marked `@external`, excluded from CI) hits the real API.
5. **Determinism:** scheduler and scoring accept an injected RNG/clock.
6. **CI gates:** `pytest` + coverage ≥ 90% on `scoring.py`/scheduler, `eslint` + `tsc`, Storybook test-runner, Playwright on a compose-built stack.

### 4.2 Build order (each phase = tests first)

| Phase | Layer | First failing tests to write |
|---|---|---|
| 0 | Repo/CI skeleton | CI runs an intentionally trivial failing test; fix it to prove the pipeline |
| 1 | `scoring.py` | CRPS of a perfect guess ≈ 0; wider interval ⇒ lower calibration bonus when IQR already covered; score monotonic in distance |
| 2 | Models + migrations | uniqueness of (thing, scale); guess immutability; snapshot math on fixture data |
| 3 | Scheduler | mix ratios over 1,000 deals with seeded RNG; never deals retired pairings; blind guarantee (response schema has no distribution fields) |
| 4 | Round API | full guess round-trip; pioneer path when n < N_min; graduation flips scoring source |
| 5 | Gemini worker | schema validation, retry, fallback; AIDistribution never appears in snapshot queries |
| 6 | React primitives | Storybook stories + interaction tests for slider/interval (keyboard + pointer), reveal animation states |
| 7 | Game loop UI | MSW-mocked round flow; preloading; error states |
| 8 | Meta systems | streaks, Daily Wave, stats page, content submission |
| 9 | e2e | Playwright suites (see WP-12) |

---

## Part 5 — Work Packages

Each package is sized for a junior developer or an AI agent working ~1–3 days, with tests written first, explicit acceptance criteria, and minimal cross-package coupling. Dependencies form a DAG; packages on the same tier can run in parallel.

### WP-01 · Project skeleton & CI *(no dependencies)*
**Goal:** monorepo with `backend/` (Django, DRF, pytest, ruff) and `frontend/` (Vite + React + TS, eslint, vitest, Storybook installed), docker-compose (Postgres, Redis), GitHub Actions running all test suites.
**TDD:** commit one failing `pytest` test and one failing `vitest` test; CI must go red; make them pass.
**Accept:** `docker compose up` serves Django on :8000 and Vite on :5173; CI green; README quickstart works on a clean machine.

### WP-02 · Scoring library *(after WP-01)*
**Goal:** pure `backend/wavelib/scoring.py` implementing the functions in §3.4.
**TDD:** property-based tests (Hypothesis): CRPS non-negative, minimized by the true distribution; visible score in [0, 1000]; monotonicity in distance; calibration bonus decreasing in width once coverage achieved; bimodality detector flags synthetic two-peak histograms and not unimodal ones.
**Accept:** ≥ 95% branch coverage; zero Django imports; docstring with the scoring formula for the game-design team.

### WP-03 · Domain models & snapshots *(after WP-01)*
**Goal:** models from §3.2 with migrations, admin registration, and a `recompute_snapshot(pairing)` service.
**TDD:** fixture of 50 synthetic guesses → snapshot median/quartiles match numpy reference; flagged (`response_ms < 1500`) and zero-weight guesses excluded; `Guess` rows immutable (save-on-existing raises).
**Accept:** `python manage.py seed_demo` creates 20 Things, 10 Scales, 60 pairings with plausible synthetic guesses.

### WP-04 · Anonymous sessions & players *(after WP-03)*
**Goal:** signed device-token session endpoint; `Player` auto-creation; account-claim endpoint stub (email magic link can be faked in dev).
**TDD:** API tests: new device → new player; same token → same player; claim merges history and invalidates the anonymous token.
**Accept:** curl demo in README; tokens are httpOnly-cookie based; no PII stored for anonymous players.

### WP-05 · Pairing scheduler *(after WP-03, uses WP-02 helpers)*
**Goal:** `deal(player) -> Pairing` implementing the 30/60/10 exploration mix, no repeats within a session window, never retired content.
**TDD:** seeded-RNG statistical tests over 1,000 deals (χ² tolerance on mix ratios); repeat-window test; blind guarantee test — serialized deal contains no `histogram`, `median`, or AI fields.
**Accept:** deal latency < 30 ms on the seeded demo DB.

### WP-06 · Round API: guess → score → reveal payload *(after WP-02, 04, 05)*
**Goal:** `GET /api/round/next/` and `POST /api/round/guess/` with the full reveal payload (snapshot histogram, score breakdown, percentile, streak state) or the pioneer payload.
**TDD:** round-trip API test; pioneer path when `n < N_min`; graduation test (16th answer flips scoring source); score stored in `RoundScore` and reproducible from stored inputs.
**Accept:** OpenAPI schema published at `/api/schema/`; MSW mocks regenerated from it into `frontend/src/mocks/`.

### WP-07 · Gemini cold-start worker *(after WP-03; parallel to WP-06)*
**Goal:** Celery task `estimate_distribution(pairing_id)`: prompt template (versioned), JSON-schema-validated response → `AIDistribution`; retries with backoff; fallback flag on failure. Triggered on first deal of a fresh pairing.
**TDD:** all tests use `FakeGeminiClient`; malformed-JSON → retry → fallback path; prompt version recorded; an `AIDistribution` must never be returned by snapshot queries (regression test).
**Accept:** one `@external`-marked smoke test against the real Gemini API (run manually); worker idempotent per pairing.

### WP-08 · React primitives: WaveSlider & IntervalHandle *(after WP-01; parallel to backend WPs)*
**Goal:** the one-thumb slider + stretchable confidence interval, plus `ScaleHeader` (left/right labels) and `ThingCard`. Fun spec: springy drag, rubber-band interval, haptic/animation ticks at 0/50/100.
**TDD:** Storybook stories for every state (idle, dragging, narrow, wide, asymmetric, disabled, RTL, mobile viewport); `@storybook/test` interaction tests: pointer-drag sets center; keyboard arrows move center, shift+arrows resize interval (a11y requirement); ARIA slider semantics verified.
**Accept:** Storybook test-runner green in CI; component is controlled, emits `{center, widthLeft, widthRight}`; 60 fps drag on a mid-range phone (manual check documented).

### WP-09 · Reveal animation & score panel *(after WP-08)*
**Goal:** `RevealWave` — histogram rises under the player's marker, overlap glow, count-up score, percentile stinger, outcome-class quip system, optional "Beat the Bot" overlay, bimodality celebration variant.
**TDD:** Storybook stories per outcome class (nailed / confidently wrong / cowardly wide / contrarian / pioneer / bimodal); interaction tests assert final DOM numbers match the payload; reduced-motion variant honors `prefers-reduced-motion`.
**Accept:** designer/PM can browse every reveal variant in Storybook without running the backend.

### WP-10 · Game loop screen *(after WP-06, 08, 09)*
**Goal:** wire the loop: next-round preloading during reveal, optimistic transitions, error/offline states, session score header, streak flame.
**TDD (write first, against MSW mocks):** vitest + Testing Library flows — happy round, pioneer round, network-fail retry, sub-1.5 s submit shows "too fast to count" toast; preload assertion (next pairing fetched before "Next" is tapped).
**Accept:** Lighthouse mobile performance ≥ 90 on the loop screen; playable start-to-guess in < 5 s on first visit.

### WP-11 · Meta layer: streaks, Daily Wave, stats, content submission *(after WP-06, 10)*
**Goal:** daily/hot streak logic (backend + UI), Daily Wave generation command + shareable emoji result, stats/archetype page, level-gated Thing/Scale submission with LLM sanity-check task (reuses WP-07 client) and moderation queue in Django admin.
**TDD:** streak edge cases (timezones, missed day, freeze item); Daily Wave identical for all players per date; share-string snapshot test; submission gating tests (level too low → 403); sanity-check fake responses drive accept/queue/reject paths.
**Accept:** archetype names/thresholds in a config file, not code; moderation queue usable by a non-developer.

### WP-12 · Playwright end-to-end suite *(after WP-10; extended after WP-11)*
**Goal:** e2e tests against the docker-compose stack (Gemini faked via env-switched stub server).
**Scenarios:**
1. First visit → anonymous session → complete 3 rounds → scores accumulate.
2. Blind guarantee: intercept network, assert no distribution data before submit (this is the dataset's integrity, tested end to end).
3. Pioneer round → provisional AI reveal labeled as such → pioneer bonus granted.
4. Account claim after reveal preserves streak and history.
5. Daily Wave completion → share string on clipboard.
6. A11y: keyboard-only full round; axe checks on loop + stats pages.
**Accept:** suite < 5 min in CI, retries only on tagged flaky network steps, trace artifacts uploaded on failure.

### WP-13 · Research export & AI-divergence dashboard *(after WP-07, 11; optional stretch)*
**Goal:** management command exporting the dataset (pairings, snapshots, AI distributions, divergence metrics) as versioned Parquet; simple staff dashboard listing top AI-vs-human divergences ("AI blind spots").
**TDD:** export schema snapshot test; divergence metrics validated against hand-computed fixtures; export excludes flagged/zero-weight guesses and all PII.
**Accept:** dataset card (README) documenting fields, licensing intent, and known biases.

### Dependency graph

```
WP-01 ─┬─ WP-02 ─┬─ WP-05 ─┐
       ├─ WP-03 ─┼─ WP-04 ─┼─ WP-06 ─┬─ WP-10 ─┬─ WP-12
       │         └─ WP-07 ─┘         │         │
       └─ WP-08 ── WP-09 ────────────┘         ├─ WP-11 ── WP-13
                                               └───────────┘
```

---

## Part 6 — Open questions to resolve before WP-06

1. `N_min` for graduation (proposed 15) and snapshot recompute cadence (proposed: every 25 new answers or 6 h).
2. Symmetric-only intervals at launch? (Proposed yes; asymmetric as a level-8 unlock.)
3. Language strategy: launch single-language; distributions are culture-specific, so per-language baselines from day one (a `language` field is already on `Thing`).
4. Licensing of the resulting dataset (CC-BY? research-only?) — affects the consent copy shown at account claim.
5. Which Gemini model tier for cold-start estimates (cost vs. quality), and whether to also collect a second model later for cross-model comparison.
