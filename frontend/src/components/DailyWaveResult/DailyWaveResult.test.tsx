import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import DailyWaveResult from "./DailyWaveResult";

const shareString = "HiveScale 2026-07-28\n🎯🌊🌫️🥶\n1910 pts · 🔥3";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DailyWaveResult", () => {
  it("renders the emoji summary, score, and streak", () => {
    render(
      <DailyWaveResult
        date="2026-07-28"
        results={["🎯", "🌊", "🌫️", "🥶"]}
        score={1910}
        dailyStreak={3}
        shareString={shareString}
      />,
    );
    expect(screen.getByTestId("wave-result-emoji")).toHaveTextContent("🎯🌊🌫️🥶");
    expect(screen.getByTestId("wave-result-score")).toHaveTextContent("1910");
    expect(screen.getByText(/🔥 3/)).toBeInTheDocument();
  });

  it("copies the exact share string to the clipboard", async () => {
    // userEvent.setup() installs a clipboard stub; spy on it after setup so the
    // spy isn't clobbered.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(
      <DailyWaveResult
        date="2026-07-28"
        results={["🎯", "🌊", "🌫️", "🥶"]}
        score={1910}
        dailyStreak={3}
        shareString={shareString}
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy result/i }));
    expect(writeText).toHaveBeenCalledWith(shareString);
    expect(await screen.findByText(/result copied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument();
  });
});
