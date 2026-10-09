// Run after `npm run build`. Prints how much JavaScript the browser downloads (compressed, as it travels) so growth is
// visible, and fails when a budget is exceeded. Budgets are deliberately generous round numbers; tighten them as the
// app settles.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_TOTAL_KB = 600; // all client JavaScript, gzip
const BUDGET_CHUNK_KB = 100; // any single chunk, gzip

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
  });
}

let files;
try {
  files = walk(".next/static");
} catch {
  console.error("No build output found. Run `npm run build` first.");
  process.exit(1);
}

const sizes = files
  .map((file) => {
    const raw = readFileSync(file);
    return { file, raw: raw.length, gzip: gzipSync(raw).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

const kb = (n) => (n / 1024).toFixed(1);
const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
console.log(
  `Client JavaScript: ${sizes.length} files, ${kb(total)} KB gzip (budget ${BUDGET_TOTAL_KB} KB)`,
);
console.log("Largest chunks (gzip KB):");
for (const s of sizes.slice(0, 8))
  console.log(`  ${kb(s.gzip).padStart(7)}  ${s.file.split("\\").join("/")}`);

const problems = [];
if (total / 1024 > BUDGET_TOTAL_KB)
  problems.push(`Total client JavaScript ${kb(total)} KB is over ${BUDGET_TOTAL_KB} KB.`);
for (const s of sizes) {
  if (s.gzip / 1024 > BUDGET_CHUNK_KB)
    problems.push(`${s.file} is ${kb(s.gzip)} KB, over ${BUDGET_CHUNK_KB} KB.`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
