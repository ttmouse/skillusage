import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { normalizeSkillName } from '../normalize.js';
import { SKILL_MD_PATH_RE } from './skill-md.js';

/**
 * Reasonix sessions are OpenAI-style JSONL with no per-line timestamps, so an
 * event can only be placed at session granularity: every event in a file gets
 * that session's meta `updated_at`. Triggers leave no explicit signal — only
 * SKILL.md paths inside tool_calls arguments (inferred). `skill_<digits>` hits
 * are a different product's opaque ids and are not skill names.
 */
const SESSION_DIR = join('Library', 'Application Support', 'reasonix', 'sessions');

interface ReasonixRow {
  role?: string;
  tool_calls?: unknown;
}

interface ReasonixMeta {
  created_at?: string;
  updated_at?: string;
}

interface ReasonixAcp {
  cwd?: string;
}

export async function collectReasonixEvents(reasonixDir?: string): Promise<ScanResult> {
  const sessionsDir = reasonixDir ?? join(homedir(), SESSION_DIR);
  let files: string[] = [];
  try {
    files = (await readdir(sessionsDir)).filter(name => name.endsWith('.jsonl'));
  } catch {
    return { events: [], filesScanned: 0 };
  }

  const events: InvocationEvent[] = [];
  for (const file of files) {
    const base = join(sessionsDir, file.slice(0, -'.jsonl'.length));
    const meta = await readJson<ReasonixMeta>(`${base}.jsonl.meta`);
    if (!meta?.updated_at) continue; // no timestamp → unplaceable events
    const acp = await readJson<ReasonixAcp>(`${base}.acp.json`);
    await parseSession(join(sessionsDir, file), meta.updated_at, acp?.cwd ?? '', events);
  }
  return { events, filesScanned: files.length };
}

async function parseSession(
  file: string,
  timestamp: string,
  cwd: string,
  events: InvocationEvent[],
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.includes('SKILL.md')) continue;

    let row: ReasonixRow;
    try {
      row = JSON.parse(line) as ReasonixRow;
    } catch {
      continue;
    }
    if (!Array.isArray(row.tool_calls)) continue;
    for (const call of row.tool_calls) {
      if (typeof call !== 'object' || call === null) continue;
      const args = (call as { arguments?: unknown }).arguments;
      if (typeof args !== 'string') continue;
      const match = SKILL_MD_PATH_RE.exec(args);
      if (!match?.[1] || /^skill_\d+$/.test(match[1])) continue;
      events.push({
        skill: normalizeSkillName(match[1]),
        fullName: match[1],
        mode: 'auto',
        inferred: true,
        source: 'reasonix',
        timestamp,
        sessionId: file,
        cwd,
        sidechain: false,
      });
    }
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
