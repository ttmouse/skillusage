import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { BUILTIN_COMMANDS } from '../builtins.js';
import { normalizeSkillName } from '../normalize.js';
import { cindyAppDir } from './cindy-paths.js';
import { parseSqliteJsonRows, querySqlite } from './sqlite.js';

/**
 * Cindy Desktop stores what no native transcript has: the explicit Skill tool
 * calls and the slash commands users typed inside Cindy. Signals are storage-
 * unique (native transcripts never contain them), so nothing double-counts.
 * Read via the system sqlite3 CLI — no npm dependency; missing CLI skips the
 * source with a warning.
 */
const MANUAL_DEDUP_WINDOW_MS = 120_000;

interface CindyRow {
  kind: 'skill' | 'slash';
  mid: string;
  tool_use_id: string | null;
  created_at: number;
  content: string;
  sid: string;
  working_dir: string | null;
}

const QUERY = `
SELECT 'skill' AS kind, m.id AS mid, m.tool_use_id AS tool_use_id, m.created_at, m.content,
       coalesce(s.sdk_session_id, s.id) AS sid, s.working_dir
FROM messages m JOIN sessions s ON s.id = m.session_id
WHERE m.role = 'tool_use' AND json_extract(m.content, '$.toolName') = 'Skill'
UNION ALL
SELECT 'slash' AS kind, m.id AS mid, NULL AS tool_use_id, m.created_at, m.content,
       coalesce(s.sdk_session_id, s.id) AS sid, s.working_dir
FROM messages m JOIN sessions s ON s.id = m.session_id
WHERE m.role = 'user' AND m.content LIKE '%slashCommandRanges%:[{%'`;

export async function collectCindyEvents(cindyDir?: string): Promise<ScanResult> {
  const db = resolveDb(cindyDir);
  if (!db) return { events: [], filesScanned: 0 };

  let rows: CindyRow[];
  try {
    rows = parseSqliteJsonRows<CindyRow>(await querySqlite(db, QUERY));
  } catch (err) {
    console.error(`skillusage: skipping cindy source (${err instanceof Error ? err.message : err})`);
    return { events: [], filesScanned: 0 };
  }

  const events: InvocationEvent[] = [];
  const seenToolUseIds = new Set<string>();
  const lastManual = new Map<string, number>();

  for (const row of rows) {
    let content: { text?: string; slashCommandRanges?: unknown; input?: { skill?: unknown } };
    try {
      content = JSON.parse(row.content);
    } catch {
      continue;
    }
    if (!content || typeof content !== 'object') continue;

    if (row.kind === 'skill') {
      // Forked sessions duplicate messages; a toolUseId is one invocation.
      if (!row.tool_use_id || seenToolUseIds.has(row.tool_use_id)) continue;
      seenToolUseIds.add(row.tool_use_id);
      const skill = content.input?.skill;
      if (typeof skill !== 'string' || !skill) continue;
      events.push(toEvent(row, skill, 'auto'));
    } else {
      const text = typeof content.text === 'string' ? content.text : '';
      const ranges = Array.isArray(content.slashCommandRanges) ? content.slashCommandRanges : [];
      for (const range of ranges) {
        const token = slashToken(text, range);
        if (!token || BUILTIN_COMMANDS.has(token)) continue;
        // The same keystroke can appear in forked copies a moment apart.
        const ts = Date.parse(toIso(row.created_at));
        const key = `${row.sid}|${token}`;
        const last = lastManual.get(key);
        if (last !== undefined && ts - last <= MANUAL_DEDUP_WINDOW_MS) continue;
        lastManual.set(key, ts);
        events.push(toEvent(row, token, 'manual'));
      }
    }
  }
  return { events, filesScanned: 1 };
}

function toEvent(row: CindyRow, fullName: string, mode: 'manual' | 'auto'): InvocationEvent {
  return {
    skill: normalizeSkillName(fullName),
    fullName,
    mode,
    inferred: false,
    source: 'cindy',
    timestamp: toIso(row.created_at),
    sessionId: row.sid,
    cwd: row.working_dir ?? '',
    sidechain: false,
  };
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function slashToken(text: string, range: unknown): string | null {
  if (typeof range !== 'object' || range === null) return null;
  const { start, end } = range as { start?: unknown; end?: unknown };
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  const raw = text.slice(start, end).trim().replace(/^\//, '').replace(/^skill:/, '');
  return raw || null;
}

function resolveDb(cindyDir?: string): string | null {
  if (cindyDir) {
    try {
      if (statSync(cindyDir).isFile()) return cindyDir;
    } catch {
      return null;
    }
    return largestDb(cindyDir);
  }
  const appDir = cindyAppDir();
  if (!existsSync(appDir)) return null;
  return largestDb(appDir);
}

function largestDb(dir: string): string | null {
  let best: string | null = null;
  let bestSize = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.startsWith('cindy-') || !name.endsWith('.db')) continue;
    const full = join(dir, name);
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    if (size > bestSize) {
      best = full;
      bestSize = size;
    }
  }
  return bestSize > 0 ? best : null;
}
