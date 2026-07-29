/**
 * Scale requests (against MSW): the available prompt with examples, a successful
 * filing, and the not-available state.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import ScaleRequestScreen from "./ScaleRequestScreen";
import { server } from "../../test/server";

describe("ScaleRequestScreen", () => {
  it("shows the prompt with examples and files a new scale", async () => {
    server.use(
      http.get("/api/scale-request/", () =>
        HttpResponse.json({
          available: true,
          thing: { id: 1, text: "Pineapple pizza" },
          examples: [{ left: "disgusting", right: "delightful" }],
          scale_request_token: "tok",
        }),
      ),
      http.post("/api/scale-request/submit/", () =>
        HttpResponse.json({ scale_id: 5, left: "cosmic", right: "mundane", pairing_id: 9 }),
      ),
    );
    const user = userEvent.setup();
    render(<ScaleRequestScreen />);

    expect(await screen.findByRole("heading", { name: "Pineapple pizza" })).toBeInTheDocument();
    expect(screen.getByText(/already taken/i)).toBeInTheDocument();
    expect(screen.getByText(/disgusting ↔ delightful/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/one pole/i), "cosmic");
    await user.type(screen.getByLabelText(/the other pole/i), "mundane");
    await user.click(screen.getByRole("button", { name: /file my scale/i }));

    expect(await screen.findByText(/filed .*cosmic.*mundane/i)).toBeInTheDocument();
  });

  it("explains when a scale request isn't available yet", async () => {
    server.use(
      http.get("/api/scale-request/", () =>
        HttpResponse.json({ available: false, reason: "Play 5 rounds today first (2/5)." }),
      ),
    );
    render(<ScaleRequestScreen />);
    expect(await screen.findByText(/play 5 rounds today first/i)).toBeInTheDocument();
  });
});
