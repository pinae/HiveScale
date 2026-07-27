/**
 * WP-08 red tests: ScaleHeader — the two bipolar scale labels.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ScaleHeader from "./ScaleHeader";

describe("ScaleHeader", () => {
  it("shows both poles of the scale", () => {
    render(<ScaleHeader left="sophisticated" right="overly complicated" />);
    expect(screen.getByText("sophisticated")).toBeInTheDocument();
    expect(screen.getByText("overly complicated")).toBeInTheDocument();
  });

  it("labels the group for assistive tech", () => {
    render(<ScaleHeader left="cheap" right="expensive" />);
    expect(
      screen.getByRole("group", { name: /cheap.*expensive/i }),
    ).toBeInTheDocument();
  });
});
