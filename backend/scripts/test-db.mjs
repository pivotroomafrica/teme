// Usage: node scripts/test-db.mjs [deploy|reset]
//   deploy (default): applies pending migrations to the TEST database (non-destructive).
//   reset: DROPS and recreates the TEST database. Run by a human only.
// Refuses to touch any database whose name does not end with _test.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.test')) {
  for (const line of readFileSync('.env.test', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const url = process.env.DATABASE_URL ?? '';
const dbName = new URL(url || 'postgresql://x/none').pathname.slice(1);
if (!dbName.endsWith('_test')) {
  console.error(`Refusing to touch "${dbName}": database name must end with _test.`);
  process.exit(1);
}
const mode = process.argv[2] ?? 'deploy';
const args =
  mode === 'reset'
    ? ['prisma', 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate']
    : ['prisma', 'migrate', 'deploy'];
const run = spawnSync('npx', args, { stdio: 'inherit', shell: true, env: process.env });
process.exit(run.status ?? 1);
