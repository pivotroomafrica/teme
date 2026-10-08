// Downloads the backend's OpenAPI document into openapi/openapi.json.
// Usage: BACKEND_OPENAPI_URL=http://localhost:3000/api/docs-json npm run api:sync
// The backend must be running with SWAGGER_ENABLED=true. Review the diff, then run `npm run api:generate`.
import { writeFile } from "node:fs/promises";

const url = process.env.BACKEND_OPENAPI_URL ?? "http://localhost:3000/api/docs-json";
const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) {
  console.error(`Could not download ${url}: HTTP ${response.status}`);
  process.exit(1);
}
const spec = await response.json();
if (!spec.openapi || !spec.paths) {
  console.error("The response is not an OpenAPI document.");
  process.exit(1);
}
await writeFile("openapi/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log(`Saved ${Object.keys(spec.paths).length} paths from ${url}`);
