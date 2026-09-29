export type InvocationMode = 'manual' | 'auto';

export type InvocationSource =
  | 'claude'
  | 'codex'
  | 'factory'
  | 'pi'
  | 'cindy'
  | 'opencode'
  | 'dsh'
  | 'reasonix';

export interface InvocationEvent {
  /** Normalized skill name (consecutive duplicate namespace segments collapsed). */
  skill: string;
  /** Raw name as found on disk. */
  fullName: string;
  /** manual = user typed it (slash command / $prefix); auto = agent-initiated. */
  mode: InvocationMode;
  /** True when the auto signal is heuristic (e.g. a Read/Bash hit on SKILL.md). */
  inferred: boolean;
  source: InvocationSource;
  /** ISO 8601. */
  timestamp: string;
  sessionId: string;
  cwd: string;
  /** True when the event happened inside a subagent sidechain. */
  sidechain: boolean;
}

export interface ScanResult {
  events: InvocationEvent[];
  filesScanned: number;
}
