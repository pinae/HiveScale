import { setupServer } from "msw/node";

/** Shared MSW server for tests; handlers are registered per test via server.use(). */
export const server = setupServer();
