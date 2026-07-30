import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { fetchNextRound } from "./client";
import { server } from "../test/server";

const deal = {
  pairing_id: 7,
  thing: { text: "Robotic lawnmower" },
  scale: { left: "sophisticated", right: "overly complicated" },
  round_token: "signed",
};

/** Capture the query string the client sends to /api/round/next/. */
function captureNextRoundQuery(): { get: () => string | null } {
  let captured: string | null = null;
  server.use(
    http.get("/api/round/next/", ({ request }) => {
      captured = new URL(request.url).searchParams.get("exclude");
      return HttpResponse.json(deal);
    }),
  );
  return { get: () => captured };
}

describe("fetchNextRound", () => {
  it("sends recently-seen pairing ids as a comma-separated exclude list", async () => {
    const query = captureNextRoundQuery();
    await fetchNextRound({ exclude: [7, 3, 9] });
    expect(query.get()).toBe("7,3,9");
  });

  it("omits the exclude param entirely when nothing has been seen", async () => {
    const query = captureNextRoundQuery();
    await fetchNextRound({ exclude: [] });
    expect(query.get()).toBeNull();
  });

  it("omits the exclude param when called with no options", async () => {
    const query = captureNextRoundQuery();
    await fetchNextRound();
    expect(query.get()).toBeNull();
  });
});
