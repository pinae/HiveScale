import "@testing-library/jest-dom";

import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

// Any fetch a test doesn't explicitly mock is a bug — fail loudly.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
