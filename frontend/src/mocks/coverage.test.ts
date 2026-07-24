// Drift guard (WP-06 / plan §4.1): every path+method the backend publishes in
// the OpenAPI schema must have a generated MSW handler, so Storybook and unit
// tests can never mock an endpoint the contract doesn't describe (or miss one).
// Regenerate with `yarn mocks:generate` after any API change.
import { describe, expect, it } from "vitest";

import { handlers } from "./handlers.generated";
import schema from "./openapi.json";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

describe("MSW mocks cover the OpenAPI contract", () => {
  it("has a handler for every path+method in the schema", () => {
    const wanted = new Set<string>();
    const paths = schema.paths as Record<string, Record<string, unknown>>;
    for (const [path, operations] of Object.entries(paths)) {
      for (const method of Object.keys(operations)) {
        if (HTTP_METHODS.includes(method)) {
          wanted.add(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    const provided = new Set(
      handlers.map((handler) => `${handler.info.method} ${String(handler.info.path)}`),
    );

    expect(wanted.size).toBeGreaterThan(0);
    for (const key of wanted) {
      expect(provided).toContain(key);
    }
  });

  it("covers the WP-06 round endpoints", () => {
    const provided = new Set(
      handlers.map((handler) => `${handler.info.method} ${String(handler.info.path)}`),
    );
    expect(provided).toContain("GET /api/round/next/");
    expect(provided).toContain("POST /api/round/guess/");
  });
});
