/**
 * WP-08 red tests: ThingCard — the concept being placed on the scale.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ThingCard from "./ThingCard";

describe("ThingCard", () => {
  it("presents the Thing as a heading", () => {
    render(<ThingCard text="Robotic lawnmower" />);
    expect(
      screen.getByRole("heading", { name: "Robotic lawnmower" }),
    ).toBeInTheDocument();
  });
});
