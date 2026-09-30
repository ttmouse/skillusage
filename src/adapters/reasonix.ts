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
 * that session's meta `updated_at`.
 *
 * Reasonix invokes skills in two explicit ways the older adapter missed:
 *   1. a dedicated `run_skill` tool call (`tool_calls[].name === 'run_skill'`,
 *      `arguments.name` is the skill);
 *   2. a `# Skill: <name>` content injection, and its `<skill-pin name="...">`
 *      tool result.
 * It also leaves inferred traces when a tool reads a `SKILL.md` path.
 * `skill_<digits>` ids are a different product's opaque ids, not skill names.
 */
const SESSION_DIR = join('Library', 'Application Support', 'reasonix', 'sessions');

/** `# Skill: <name>` at the start of a content block (also matches tool echoes). */
const SKILL_INJECT_RE = /^#\s*Skill:\s*([A-Za-z0-9_./:-]+)/m;
/** `<skill-pin name="<name>">` tool result marker. */
const SKILL_PIN_RE = /<skill-pin\s+name="([^"]+)"/;

interface ReasonixRow {
  role?: string;
  content?: unknown;
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

/** Parse a `run_skill` `arguments` payload that may be a JSON string or object. */
function skillFromRunSkillArgs(args: unknown): string | null {
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const name = (parsed as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name : null;
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

  // Reasonix carries no per-line timestamps, so every event in a session shares
  // one timestamp. Dedupe explicit invocations per skill for the whole session
  // (the run_skill call, the # Skill: injection and the skill-pin echo would
  // otherwise each count the same invocation).
  const explicitSeen = new Set<string>();
  const inferredSeen = new Set<string>();
  const sessionId = file;

  const pushExplicit = (raw: string): void => {
    const name = raw.trim();
    if (!name || /^skill_\d+$/.test(name)) return;
    const skill = normalizeSkillName(name);
    if (!skill || explicitSeen.has(skill)) return;
    explicitSeen.add(skill);
    events.push({
      skill,
      fullName: name,
      mode: 'auto',
      inferred: false,
      source: 'reasonix',
      timestamp,
      sessionId,
      cwd,
      sidechain: false,
    });
  };

  const pushInferred = (raw: string): void => {
    const name = raw.trim();
    if (!name || /^skill_\d+$/.test(name)) return;
    const skill = normalizeSkillName(name);
    if (!skill || explicitSeen.has(skill) || inferredSeen.has(skill)) return;
    inferredSeen.add(skill);
    events.push({
      skill,
      fullName: name,
      mode: 'auto',
      inferred: true,
      source: 'reasonix',
      timestamp,
      sessionId,
      cwd,
      sidechain: false,
    });
  };

  for await (const line of rl) {
    if (
      !line.includes('SKILL.md') &&
      !line.includes('run_skill') &&
      !line.includes('# Skill:') &&
      !line.includes('skill-pin')
    ) {
      continue;
    }

    let row: ReasonixRow;
    try {
      row = JSON.parse(line) as ReasonixRow;
    } catch {
      continue;
    }

    // Explicit: a dedicated run_skill tool call, or an inferred SKILL.md read
    // inside any other tool call's arguments.
    if (Array.isArray(row.tool_calls)) {
      for (const call of row.tool_calls) {
        if (typeof call !== 'object' || call === null) continue;
        const { name, arguments: args } = call as { name?: unknown; arguments?: unknown };
        if (name === 'run_skill') {
          const skill = skillFromRunSkillArgs(args);
          if (skill) pushExplicit(skill);
          continue;
        }
        if (typeof args !== 'string' || !args.includes('SKILL.md')) continue;
        for (const match of args.matchAll(new RegExp(SKILL_MD_PATH_RE.source, 'g'))) {
          if (match[1]) pushInferred(match[1]);
        }
      }
    }

    // Explicit: the `# Skill: <name>` content injection and its skill-pin echo.
    if (typeof row.content === 'string') {
      if (row.content.includes('# Skill:')) {
        const inject = SKILL_INJECT_RE.exec(row.content);
        if (inject?.[1]) pushExplicit(inject[1]);
      }
      if (row.content.includes('skill-pin')) {
        const pin = SKILL_PIN_RE.exec(row.content);
        if (pin?.[1]) pushExplicit(pin[1]);
      }
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
