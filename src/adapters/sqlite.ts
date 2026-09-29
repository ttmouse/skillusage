import { execFile } from 'node:child_process';

/**
 * Query a SQLite database through the system sqlite3 CLI — keeps the CLI
 * dependency-free (no npm sqlite driver). URI mode keeps databases with live
 * writers readable; -readonly is the fallback for builds without URI support.
 */
export function querySqlite(db: string, sql: string): Promise<string> {
  const run = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile('sqlite3', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });

  return run(['-json', `file:${db}?mode=ro`, sql]).catch(() => run(['-readonly', '-json', db, sql]));
}

export function parseSqliteJsonRows<T>(stdout: string): T[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as T[];
  return Array.isArray(parsed) ? parsed : [];
}
