// Fails when src/lib/api/generated/schema.d.ts is not exactly what openapi/openapi.json generates,
// i.e. someone changed the spec snapshot without regenerating (or edited the generated file by hand).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(mkdtempSync(join(tmpdir(), "api-check-")), "schema.d.ts");
const run = spawnSync(
  "npx",
  ["openapi-typescript", "openapi/openapi.json", "-o", out, "--default-non-nullable", "false"],
  {
    shell: true,
    stdio: "pipe",
  },
);
if (run.status !== 0) {
  console.error(run.stderr.toString());
  process.exit(1);
}
const fresh = readFileSync(out, "utf8");
const committed = readFileSync("src/lib/api/generated/schema.d.ts", "utf8");
if (fresh !== committed) {
  console.error("Generated API types are out of date. Run: npm run api:generate");
  process.exit(1);
}
console.log("Generated API types match openapi/openapi.json");
