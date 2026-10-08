// Run after `npm run build`. Fails if anything that must stay on the server (or in development) appears in
// the JavaScript that is sent to browsers: mock backend data, server-only configuration names or secrets.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  ["mock backend credentials", "mock-password-1"],
  ["mock access tokens", "mock-access."],
  ["mock refresh tokens", "mock-refresh."],
  ["mock accounts", "owner@mock.test"],
  ["server session secret name", "TC_SESSION_SECRET"],
  ["server API base URL name", "TC_API_BASE_URL"],
  ["server API mode name", "TC_API_MODE"],
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
  });
}

const root = ".next/static";
let files;
try {
  files = walk(root);
} catch {
  console.error("No build output found. Run `npm run build` first.");
  process.exit(1);
}

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [label, needle] of FORBIDDEN) {
    if (text.includes(needle)) problems.push(`${label} ("${needle}") found in ${file}`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `Checked ${files.length} browser bundles: no mock data or server configuration inside.`,
);
