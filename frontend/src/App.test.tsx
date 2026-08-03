/**
 * The app boots straight into the game loop: the brand header is
 * present immediately and the first round is dealt from the backend.
 */
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import App from "./App";
import { server } from "./test/server";

describe("App", () => {
  it("shows the brand and deals the first round", async () => {
    server.use(
      http.post("/api/session/", () =>
        HttpResponse.json({ player: { level: 1, xp: 0, is_claimed: false }, created: true }),
      ),
      http.get("/api/round/next/", () =>
        HttpResponse.json({
          pairing_id: 1,
          thing: { text: "Robotic lawnmower" },
          scale: { left: "sophisticated", right: "overly complicated" },
          round_token: "tok",
        }),
      ),
    );
    render(<App />);

    expect(screen.getByRole("heading", { name: /hivescale/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Robotic lawnmower" })).toBeInTheDocument();
  });
});
