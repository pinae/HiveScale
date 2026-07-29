/**
 * Thing challenge (against MSW): read the prompt, submit a thing, see the reward,
 * and fold the banked XP back into the caller.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import ChallengeScreen from "./ChallengeScreen";
import { server } from "../../test/server";

const deal = {
  first_scale: { id: 1, left: "boring", right: "thrilling" },
  second_scale: { id: 2, left: "cheap", right: "luxurious" },
  max_words: 3,
  reward_xp: 25000,
  challenge_token: "tok",
};

const result = {
  thing_id: 7,
  text: "sentient toaster",
  xp_awarded: 25000,
  player: { xp: 25000, level: 10, multiplier: 1 },
  progress: { level: 10, xp: 25000, into_level: 0, level_span: 3000000, next_level_xp: 11000000 },
  unlocks: { vote: true, challenge: true },
};

describe("ChallengeScreen", () => {
  it("submits a thing, shows the reward, and reports the new profile", async () => {
    server.use(
      http.get("/api/challenge/next/", () => HttpResponse.json(deal)),
      http.post("/api/challenge/", () => HttpResponse.json(result)),
    );
    const onReward = vi.fn();
    const user = userEvent.setup();
    render(<ChallengeScreen onReward={onReward} />);

    await user.type(await screen.findByLabelText(/your thing/i), "sentient toaster");
    await user.click(screen.getByRole("button", { name: /submit for/i }));

    expect(await screen.findByText(/\+25,000 XP/)).toBeInTheDocument();
    expect(onReward).toHaveBeenCalledWith(result);
    expect(screen.getByRole("button", { name: /another challenge/i })).toBeInTheDocument();
  });

  it("surfaces a validation error and keeps the form", async () => {
    server.use(
      http.get("/api/challenge/next/", () => HttpResponse.json(deal)),
      http.post("/api/challenge/", () =>
        HttpResponse.json({ detail: "Enter a thing in 3 words or fewer." }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    render(<ChallengeScreen onReward={() => {}} />);

    await user.type(await screen.findByLabelText(/your thing/i), "one two three four");
    await user.click(screen.getByRole("button", { name: /submit for/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/3 words or fewer/i);
  });
});
