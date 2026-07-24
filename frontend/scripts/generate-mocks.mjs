// Regenerates MSW request handlers from the backend's exported OpenAPI schema
// so the frontend mocks can never drift from the API contract (WP-06 / plan
// §4.1). Reads src/mocks/openapi.json and writes src/mocks/handlers.generated.ts.
//
// Run via `yarn mocks:generate`, which re-exports the schema first.
import { readFileSync, writeFileSync } from "node:fs";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const schemaUrl = new URL("../src/mocks/openapi.json", import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, "utf8"));

function firstExample(operation) {
  // drf-spectacular nests response examples under
  // responses.<code>.content["application/json"].examples.<name>.value.
  const responses = operation.responses ?? {};
  const ok = responses["200"] ?? responses["201"] ?? Object.values(responses)[0];
  const json = ok?.content?.["application/json"];
  if (!json) return {};
  if (json.examples) {
    const example = Object.values(json.examples)[0];
    if (example?.value !== undefined) return example.value;
  }
  if (json.example !== undefined) return json.example;
  return {};
}

const entries = [];
for (const [path, operations] of Object.entries(schema.paths)) {
  for (const [method, operation] of Object.entries(operations)) {
    if (!HTTP_METHODS.includes(method)) continue;
    const body = JSON.stringify(firstExample(operation), null, 2).replace(
      /\n/g,
      "\n    ",
    );
    entries.push(
      `  http.${method}("${path}", () =>\n    HttpResponse.json(${body})),`,
    );
  }
}

const output =
  "// AUTO-GENERATED from openapi.json by scripts/generate-mocks.mjs.\n" +
  "// Do not edit by hand — run `yarn mocks:generate` to refresh.\n" +
  'import { http, HttpResponse } from "msw";\n\n' +
  `export const handlers = [\n${entries.join("\n")}\n];\n`;

writeFileSync(new URL("../src/mocks/handlers.generated.ts", import.meta.url), output);
console.log(`Generated ${entries.length} MSW handlers from the OpenAPI schema.`);
