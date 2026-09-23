/**
 * `node:sqlite` is a Node built-in, but neither vitest's transform pipeline
 * nor esbuild's bundler reliably resolve a plain `import ... from 'node:sqlite'`
 * (Vite's dependency scanner and esbuild's own module resolver both try to
 * treat it as a package first). `process.getBuiltinModule` sidesteps module
 * resolution entirely and works identically under both tools and under plain
 * `node dist-server/server.mjs`.
 */
export interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: { open?: boolean }) => SqliteDatabase;
}

export function openDatabase(path: string): SqliteDatabase {
  const sqlite = process.getBuiltinModule('node:sqlite') as NodeSqliteModule | undefined;
  if (!sqlite) throw new Error('node:sqlite is not available in this Node runtime (need Node >= 22.5)');
  return new sqlite.DatabaseSync(path);
}
