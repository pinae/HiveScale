/**
 * Pairing curation (against MSW): judge a combo, see the outcome, advance to the
 * next one; and the empty state when there's nothing to vote on.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import VoteScreen from "./VoteScreen";
import { server } from "../../test/server";

const candidate = (n: number, existing = false) => ({
  thing: { id: n, text: n === 1 ? "Robotic lawnmower" : "Fax machine" },
  scale: { id: n, left: "sophisticated", right: "overly complicated" },
  pairing_id: existing ? n : null,
  existing,
});

describe("VoteScreen", () => {
  it("votes on a candidate, shows the outcome, and advances", async () => {
    let served = 0;
    server.use(
      http.get("/api/vote/next/", () => {
        served += 1;
        return HttpResponse.json(served === 1 ? candidate(1) : candidate(2, true));
      }),
      http.post("/api/vote/", () => HttpResponse.json({ outcome: "added", pairing_id: 9 })),
    );
    const user = userEvent.setup();
    render(<VoteScreen />);

    expect(await screen.findByRole("heading", { name: "Robotic lawnmower" })).toBeInTheDocument();
    expect(screen.getByText(/new combo/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /interesting/i }));

    expect(await screen.findByText(/added!/i)).toBeInTheDocument();
    // advanced to the next (existing) pairing
    expect(await screen.findByRole("heading", { name: "Fax machine" })).toBeInTheDocument();
    expect(screen.getByText(/existing pairing/i)).toBeInTheDocument();
  });

  it("shows an empty state when there's nothing to vote on", async () => {
    server.use(
      http.get("/api/vote/next/", () => HttpResponse.json({ detail: "none" }, { status: 404 })),
    );
    render(<VoteScreen />);
    expect(await screen.findByText(/nothing to vote on/i)).toBeInTheDocument();
  });
});
