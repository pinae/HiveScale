/**
 * Playing a battle (against MSW): the round barrier, the relative standing after
 * each answer, the speed-bonus badge, and the final result.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PvpScreen from "./PvpScreen";
import { server } from "../../test/server";

const CODE = "abc123";

const entry = (index: number, means: number, belief: number, bonus = false) => ({
  index,
  points: 700,
  means_match: means,
  belief_match: belief,
  response_ms: 4000,
  speed_bonus: bonus,
});

const slot = (index: number, started: boolean) => ({
  index,
  started,
  opponent_ready: started,
  ...(started
    ? {
        pairing_id: 7,
        thing: { text: "Robotic lawnmower" },
        scale: { left: "sophisticated", right: "overly complicated" },
        pvp_token: `tok-${index}`,
      }
    : {}),
});

const state = (over: Partial<Record<string, unknown>> = {}) => ({
  join_code: CODE,
  total: 10,
  opponent_joined: true,
  you: { answered: 0, score: 0, entries: [] },
  opponent: { answered: 0, score: 0, entries: [] },
  speed_bonus_next: false,
  next: slot(0, true),
  completed: false,
  result: null,
  ...over,
});

const reveal = (over: Partial<Record<string, unknown>> = {}) => ({
  source: "human",
  counted: true,
  score: {
    total: 700,
    means_match: 0.7,
    belief_match: 0.6,
    good_match: true,
    good_match_threshold: 0.7,
  },
  crowd: {
    histogram: Array(20).fill(0.05),
    belief_histogram: Array(20).fill(0.05),
    median: 52,
    q25: 44,
    q75: 60,
    n: 30,
  },
  percentile: 70,
  bimodal: false,
  streak: { hot: 1 },
  player: { xp: 700, level: 5 },
  speed_bonus: false,
  ...over,
});

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, // reduced motion keeps the reveal synchronous
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia by default.
  delete window.matchMedia;
});

describe("PvpScreen", () => {
  it("waits for the opponent, then shows the question once the barrier releases", async () => {
    let readyCalls = 0;
    server.use(
      http.get(`/api/pvp/${CODE}/`, () => HttpResponse.json(state({ next: slot(0, false) }))),
      http.post(`/api/pvp/${CODE}/ready/`, async () => {
        readyCalls += 1;
        // First poll times out (friend not there yet), the second releases. The
        // small delay mimics the server-side long poll, so the waiting state is
        // actually observable rather than flashing past in one tick.
        await new Promise((resolve) => setTimeout(resolve, 60));
        return readyCalls === 1
          ? HttpResponse.json({ waiting: true, index: 0 })
          : HttpResponse.json({ waiting: false, index: 0, ...state() });
      }),
    );
    render(<PvpScreen joinCode={CODE} />);

    expect(await screen.findByText(/waiting for your friend/i)).toBeInTheDocument();
    // The question only appears after the barrier releases — never before.
    expect(await screen.findByRole("heading", { name: "Robotic lawnmower" })).toBeInTheDocument();
    expect(readyCalls).toBeGreaterThanOrEqual(2);
  });

  it("answers a round and reports that you got there first", async () => {
    server.use(
      http.get(`/api/pvp/${CODE}/`, () => HttpResponse.json(state())),
      http.post(`/api/pvp/${CODE}/ready/`, () =>
        HttpResponse.json({ waiting: false, index: 0, ...state() }),
      ),
      http.post(`/api/pvp/${CODE}/guess/`, () =>
        HttpResponse.json(
          reveal({
            match: state({
              you: { answered: 1, score: 700, entries: [entry(0, 0.7, 0.6)] },
              opponent: { answered: 0, score: 0, entries: [] },
              next: slot(1, false),
            }),
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<PvpScreen joinCode={CODE} />);

    await screen.findByRole("heading", { name: "Robotic lawnmower" });
    await user.click(screen.getByRole("button", { name: /lock it in/i }));

    expect(await screen.findByText(/got there first/i)).toBeInTheDocument();
  });

  it("shows the lead and flags a doubled next round", async () => {
    server.use(
      http.get(`/api/pvp/${CODE}/`, () => HttpResponse.json(state())),
      http.post(`/api/pvp/${CODE}/ready/`, () =>
        HttpResponse.json({ waiting: false, index: 0, ...state() }),
      ),
      http.post(`/api/pvp/${CODE}/guess/`, () =>
        HttpResponse.json(
          reveal({
            match: state({
              you: { answered: 1, score: 700, entries: [entry(0, 0.7, 0.6)] },
              opponent: { answered: 1, score: 450, entries: [entry(0, 0.4, 0.3)] },
              speed_bonus_next: true,
              next: slot(1, false),
            }),
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<PvpScreen joinCode={CODE} />);

    await screen.findByRole("heading", { name: "Robotic lawnmower" });
    await user.click(screen.getByRole("button", { name: /lock it in/i }));

    expect(await screen.findByText(/you lead by 250 points/i)).toBeInTheDocument();
    expect(screen.getByText(/next round is worth double/i)).toBeInTheDocument();
  });

  it("badges a round that actually scored double", async () => {
    server.use(
      http.get(`/api/pvp/${CODE}/`, () => HttpResponse.json(state())),
      http.post(`/api/pvp/${CODE}/ready/`, () =>
        HttpResponse.json({ waiting: false, index: 0, ...state() }),
      ),
      http.post(`/api/pvp/${CODE}/guess/`, () =>
        HttpResponse.json(
          reveal({
            speed_bonus: true,
            match: state({
              you: { answered: 1, score: 1400, entries: [entry(0, 0.7, 0.6, true)] },
              opponent: { answered: 1, score: 450, entries: [entry(0, 0.4, 0.3)] },
              next: slot(1, false),
            }),
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<PvpScreen joinCode={CODE} />);

    await screen.findByRole("heading", { name: "Robotic lawnmower" });
    await user.click(screen.getByRole("button", { name: /lock it in/i }));

    expect(await screen.findByText(/that round scored double/i)).toBeInTheDocument();
  });

  it("lands on the result with the winner and the arrow-chain diagram", async () => {
    const finished = state({
      you: { answered: 10, score: 7000, entries: [entry(0, 0.8, 0.7), entry(1, 0.6, 0.9)] },
      opponent: { answered: 10, score: 4000, entries: [entry(0, 0.3, 0.2), entry(1, 0.4, 0.3)] },
      next: null,
      completed: true,
      result: {
        winner: "you",
        margin: 1.5,
        score_margin: 3000,
        you_end: { x: 1.4, y: 1.6 },
        opponent_end: { x: 0.7, y: 0.5 },
      },
    });
    server.use(http.get(`/api/pvp/${CODE}/`, () => HttpResponse.json(finished)));
    render(<PvpScreen joinCode={CODE} />);

    expect(await screen.findByText(/you win/i)).toBeInTheDocument();
    expect(screen.getByTestId("pvp-diagram")).toBeInTheDocument();
    expect(screen.getByTestId("pvp-your-score")).toHaveTextContent("7000");
  });

  it("shows an informative wait — not a dead end — when you finish first", async () => {
    // Regression: finishing your own rounds is not the end of the match, since
    // the result only exists once the opponent finishes too. This used to render
    // a static "waiting…" with nothing behind it; usePvpMatch now polls (covered
    // in usePvpMatch.test.tsx) and this screen reports what it's waiting for.
    server.use(
      http.get(`/api/pvp/${CODE}/`, () =>
        HttpResponse.json(
          state({
            you: { answered: 10, score: 7000, entries: [entry(0, 0.8, 0.7)] },
            opponent: { answered: 9, score: 3600, entries: [entry(0, 0.3, 0.2)] },
            next: null,
            completed: false,
            result: null,
          }),
        ),
      ),
    );
    render(<PvpScreen joinCode={CODE} />);

    const waiting = await screen.findByTestId("pvp-awaiting-result");
    expect(waiting).toHaveTextContent(/waiting for your friend to finish/i);
    expect(waiting).toHaveTextContent(/1 remaining round/i);
    expect(waiting).toHaveTextContent(/you scored 7000/i);
  });

  it("surfaces a failure with a retry", async () => {
    server.use(http.get(`/api/pvp/${CODE}/`, () => new HttpResponse(null, { status: 500 })));
    render(<PvpScreen joinCode={CODE} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
