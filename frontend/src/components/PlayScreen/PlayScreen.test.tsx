/**
 * WP-10 flows (against MSW): a happy round, a pioneer round, the too-fast toast,
 * next-round preloading during the reveal, and error/offline retry.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PlayScreen from "./PlayScreen";
import { server } from "../../test/server";

const roundA = {
  pairing_id: 1,
  thing: { text: "Robotic lawnmower" },
  scale: { left: "sophisticated", right: "overly complicated" },
  round_token: "tokA",
};
const roundB = {
  pairing_id: 2,
  thing: { text: "Pineapple pizza" },
  scale: { left: "disgusting", right: "delightful" },
  round_token: "tokB",
};

const humanReveal = (counted = true) => ({
  source: "human",
  counted,
  score: { total: 812, means_match: 0.72, belief_match: 0.66, good_match: true },
  crowd: { histogram: Array(20).fill(0.05), belief_histogram: Array(20).fill(0.05), median: 52, q25: 44, q75: 60, n: 30 },
  percentile: 76,
  bimodal: false,
  streak: { hot: counted ? 3 : 0 },
  player: { xp: counted ? 812 : 0, level: 2 },
});

const pioneerReveal = {
  source: "pioneer",
  counted: true,
  pioneer_bonus: 550,
  ai_estimate: null,
  streak: { hot: 0 },
  player: { xp: 550, level: 1 },
};

const sessionOk = http.post("/api/session/", () =>
  HttpResponse.json({ player: { level: 1, xp: 0, is_claimed: false }, created: true }),
);

// Reveal animations settle instantly under reduced motion — keep tests sync.
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
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

describe("PlayScreen", () => {
  it("plays a happy round, preloads the next during the reveal, then advances", async () => {
    let nextCount = 0;
    server.use(
      sessionOk,
      http.get("/api/round/next/", () => {
        nextCount += 1;
        return HttpResponse.json(nextCount === 1 ? roundA : roundB);
      }),
      http.post("/api/round/guess/", () => HttpResponse.json(humanReveal(true))),
    );
    const user = userEvent.setup();
    render(<PlayScreen />);

    expect(await screen.findByRole("heading", { name: "Robotic lawnmower" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /lock it in/i }));

    expect(await screen.findByTestId("reveal-score-total")).toHaveTextContent("812");
    expect(screen.getByTestId("session-xp")).toHaveTextContent("812");

    // The next round was preloaded during the reveal (a 2nd GET before "Next").
    await waitFor(() => expect(nextCount).toBe(2));

    await user.click(screen.getByRole("button", { name: /next round/i }));
    expect(await screen.findByRole("heading", { name: "Pineapple pizza" })).toBeInTheDocument();
    expect(nextCount).toBe(2); // advancing used the preloaded round, no extra fetch
  });

  it("pops a level-up explainer when a round crosses an unlock milestone", async () => {
    // Boot at level 1, then a round returns level 2 — the multiplier unlock.
    server.use(
      sessionOk,
      http.get("/api/round/next/", () => HttpResponse.json(roundA)),
      http.post("/api/round/guess/", () => HttpResponse.json(humanReveal(true))),
    );
    const user = userEvent.setup();
    render(<PlayScreen />);

    await user.click(await screen.findByRole("button", { name: /lock it in/i }));

    const dialog = await screen.findByRole("dialog", { name: /multiplier unlocked/i });
    await user.click(within(dialog).getByRole("button", { name: /got it/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the pioneer payload on an ungraduated pairing", async () => {
    server.use(
      sessionOk,
      http.get("/api/round/next/", () => HttpResponse.json(roundA)),
      http.post("/api/round/guess/", () => HttpResponse.json(pioneerReveal)),
    );
    const user = userEvent.setup();
    render(<PlayScreen />);

    await user.click(await screen.findByRole("button", { name: /lock it in/i }));
    expect(await screen.findByText(/pioneer round/i)).toBeInTheDocument();
    expect(screen.getByTestId("reveal-score-total")).toHaveTextContent("550");
  });

  it("shows a too-fast toast when the answer didn't count", async () => {
    server.use(
      sessionOk,
      http.get("/api/round/next/", () => HttpResponse.json(roundA)),
      http.post("/api/round/guess/", () => HttpResponse.json(humanReveal(false))),
    );
    const user = userEvent.setup();
    render(<PlayScreen />);

    await user.click(await screen.findByRole("button", { name: /lock it in/i }));
    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent(/too fast/i);
    expect(screen.getByTestId("session-xp")).toHaveTextContent("0");
  });

  it("surfaces an error and retries after a network failure", async () => {
    let fail = true;
    server.use(
      sessionOk,
      http.get("/api/round/next/", () =>
        fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(roundA),
      ),
    );
    const user = userEvent.setup();
    render(<PlayScreen />);

    expect(await screen.findByText(/couldn.t reach the game/i)).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Robotic lawnmower" })).toBeInTheDocument();
  });

  it("saves progress: the claim panel requests a link, confirms, and marks the session saved", async () => {
    server.use(
      sessionOk,
      http.get("/api/round/next/", () => HttpResponse.json(roundA)),
      http.post("/api/session/claim/request/", () =>
        HttpResponse.json({ detail: "Claim link issued.", claim_token: "tok" }),
      ),
      http.post("/api/session/claim/confirm/", () =>
        HttpResponse.json({ player: { level: 2, xp: 999, is_claimed: true }, merged: false }),
      ),
    );
    const user = userEvent.setup();
    render(<PlayScreen />);
    await screen.findByRole("button", { name: /lock it in/i });

    await user.click(screen.getByRole("button", { name: /save progress/i }));
    await user.type(screen.getByLabelText(/email/i), "me@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));
    await user.click(await screen.findByRole("button", { name: /confirm now/i }));

    // Back in the game, the session now shows as saved with the merged profile.
    await screen.findByRole("button", { name: /lock it in/i });
    expect(screen.getByTestId("session-saved")).toBeInTheDocument();
    expect(screen.getByTestId("session-xp")).toHaveTextContent("999");
  });

  it("opens the stats page and returns to the game", async () => {
    server.use(
      sessionOk,
      http.get("/api/round/next/", () => HttpResponse.json(roundA)),
      http.get("/api/me/stats/", () =>
        HttpResponse.json({
          archetype: { name: "Oracle", blurb: "Tight and right." },
          calibration: { n: 12, hit_rate: 0.7, mean_width: 22 },
          streaks: { hot: 3, daily: 5, freezes: 1 },
          xp: 3200,
          level: 4,
        }),
      ),
    );
    const user = userEvent.setup();
    render(<PlayScreen />);

    await screen.findByRole("heading", { name: "Robotic lawnmower" });
    await user.click(screen.getByRole("button", { name: /^stats$/i }));
    expect(await screen.findByTestId("archetype-name")).toHaveTextContent("Oracle");

    await user.click(screen.getByRole("button", { name: /back to the game/i }));
    expect(await screen.findByRole("heading", { name: "Robotic lawnmower" })).toBeInTheDocument();
  });
});
