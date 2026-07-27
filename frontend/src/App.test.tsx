/**
 * WP-01 red test: the app shell must render the game title and a
 * live backend-status indicator region. Written before App.tsx exists.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";

describe("App shell", () => {
  it("renders the game title", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /baseline guesser/i }),
    ).toBeInTheDocument();
    // Let the health-check effect settle so its state update stays inside act().
    await screen.findByText(/backend online/i);
  });

  it("exposes a backend status region for the compose smoke check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
    await screen.findByText(/backend online/i);
  });
});
