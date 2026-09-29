import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { normalizeSkillName } from '../normalize.js';
import { SKILL_MD_PATH_RE } from './skill-md.js';
import { parseSqliteJsonRows, querySqlite } from './sqlite.js';

/**
 * OpenCode has a dedicated `skill` tool (explicit signals) and leaves only
 * SKILL.md reads for everything else (inferred). The `part` table carries its
 * own session_id + time_created, so one join against `session` yields cwd.
 * The database is several GB with a live writer; `immutable=1` bypasses WAL
 * locks at the cost of possibly missing the very last writes.
 */
const SKILL_MD_TOOLS = new Set(['read', 'bash', 'filesystem_read_text_file']);

interface PartRow {
  session_id: string;
  time_created: number;
  directory: string | null;
  data: string;
}

const QUERY = `
SELECT p.session_id, p.time_created, s.directory, p.data
FROM part p JOIN session s ON s.id = p.session_id
WHERE p.data LIKE '%SKILL.md%' OR p.data LIKE '%"tool":"skill"%'`;

export async function collectOpencodeEvents(opencodeDir?: string): Promise<ScanResult> {
  const db = join(opencodeDir ?? join(homedir(), '.local', 'share', 'opencode'), 'opencode.db');
  if (!existsSync(db)) return { events: [], filesScanned: 0 };

  let rows: PartRow[];
  try {
    rows = parseSqliteJsonRows<PartRow>(await querySqlite(`file:${db}?mode=ro&immutable=1`, QUERY));
  } catch (err) {
    console.error(`skillusage: skipping opencode source (${err instanceof Error ? err.message : err})`);
    return { events: [], filesScanned: 0 };
  }

  const events: InvocationEvent[] = [];
  for (const row of rows) {
    let part: {
      type?: string;
      tool?: string;
      state?: { input?: Record<string, unknown> };
      input?: Record<string, unknown>;
    };
    try {
      part = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (part.type !== 'tool' || typeof part.tool !== 'string') continue;

    const input = part.state?.input ?? part.input;
    if (part.tool === 'skill') {
      const name = input?.name;
      if (typeof name !== 'string' || !name) continue;
      events.push(toEvent(row, name, false));
    } else if (SKILL_MD_TOOLS.has(part.tool)) {
      const match = SKILL_MD_PATH_RE.exec(JSON.stringify(input ?? {}));
      if (match?.[1]) events.push(toEvent(row, match[1], true));
    }
  }
  return { events, filesScanned: 1 };
}

function toEvent(row: PartRow, fullName: string, inferred: boolean): InvocationEvent {
  return {
    skill: normalizeSkillName(fullName),
    fullName,
    mode: 'auto',
    inferred,
    source: 'opencode',
    timestamp: new Date(row.time_created).toISOString(),
    sessionId: row.session_id,
    cwd: row.directory ?? '',
    sidechain: false,
  };
}
