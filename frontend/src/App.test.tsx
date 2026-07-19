/**
 * WP-01 red test: the app shell must render the game title and a
 * live backend-status indicator region. Written before App.tsx exists.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";

describe("App shell", () => {
  it("renders the game title", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /societal wavelength/i }),
    ).toBeInTheDocument();
  });

  it("exposes a backend status region for the compose smoke check", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
  });
});
