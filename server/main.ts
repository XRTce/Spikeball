/**
 * Process entrypoint: reads env, starts the HTTP server, shuts down cleanly.
 * See docs/SYNC.md "Deployment" for what each variable does.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createApp } from './app';

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const port = envInt('PORT', 8080);
const host = env('HOST', '0.0.0.0');
const dataDir = resolve(env('RALLY_DATA_DIR', './.data'));
const dbPath = join(dataDir, 'rally.db');
const staticDir = process.env.RALLY_STATIC_DIR ? resolve(process.env.RALLY_STATIC_DIR) : resolve('./dist');
const corsOrigin = process.env.RALLY_CORS_ORIGIN ?? null;
const retentionDays = envInt('RALLY_RETENTION_DAYS', 365);
const trustProxy = process.env.RALLY_TRUST_PROXY === '1';

mkdirSync(dirname(dbPath), { recursive: true });

const app = createApp({
  dbPath,
  staticDir,
  corsOrigin,
  trustProxy,
  retentionDays,
});

app.server.listen(port, host, () => {
  console.log(
    `rally sync server listening on ${host}:${port} (data: ${dataDir}, static: ${staticDir}, cors: ${corsOrigin ?? 'same-origin only'})`,
  );
});

app.server.on('error', (error) => {
  console.error('server error', error);
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);
  app
    .close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('error during shutdown', error);
      process.exit(1);
    });
  // Do not wait forever for in-flight SSE connections to drain.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
