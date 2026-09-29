import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Cindy Desktop bundles its own agent homes, so sessions started there never
 * reach ~/.codex or ~/.pi. Paths only exist on macOS installs; adapters that
 * use them no-op when the directory is missing.
 */
export function cindyAppDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'Cindy');
}

export function cindyCodexSessionsDir(): string {
  return join(cindyAppDir(), 'codex-home', 'sessions');
}

export function cindyPiSessionsDir(): string {
  return join(cindyAppDir(), 'pi-agent-home', 'sessions');
}
