/**
 * Dev-only PostgreSQL for machines where Docker is unavailable.
 * Docker (`npm run db:up`) remains the documented default.
 * Data lives in backend/.pgdata (gitignored). Credentials match .env.example.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.pgdata');
const fresh = !existsSync(join(databaseDir, 'PG_VERSION'));
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'temelash',
  password: 'change_me',
  port: Number(process.env.PGPORT ?? 5432),
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'timezone=UTC', '-c', 'log_timezone=UTC'],
});
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase('temelashcard');
  await pg.createDatabase('temelashcard_test');
}
console.log('PostgreSQL ready on localhost:' + (process.env.PGPORT ?? 5432) + ' (Ctrl+C to stop)');
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
