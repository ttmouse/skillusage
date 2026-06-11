import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { normalizeSkillName } from '../normalize.js';

const INJECTION_RE = /^<skill>\s*<name>([^<\n]+)<\/name>/;
const SKILL_MD_PATH_RE = /\/skills\/([^/\s"'\\]+)\/SKILL\.md/;
const MANUAL_SKILL_RE = /^\$([A-Za-z0-9:_./-]+)/;
/** Manual signals for the same (session, skill) within this window are one keystroke. */
const MANUAL_DEDUP_WINDOW_MS = 120_000;
/** An injection within this window of a manual $invocation is its echo, not a separate call. */
const MANUAL_ECHO_WINDOW_MS = 300_000;

interface RolloutRow {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    cwd?: string;
    role?: string;
    message?: unknown;
    arguments?: unknown;
    content?: unknown;
  };
}

interface Candidate {
  skill: string;
  fullName: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
}

export async function collectCodexEvents(codexDir?: string): Promise<ScanResult> {
  const root = codexDir ?? join(homedir(), '.codex');
  const files = [
    ...(await listJsonl(join(root, 'sessions'))),
    ...(await listJsonl(join(root, 'archived_sessions'))),
  ];

  const events: InvocationEvent[] = [];
  const manualCandidates: Candidate[] = [];
  const injections: Candidate[] = [];
  const cwdBySession = new Map<string, string>();

  for (const file of files) {
    await parseRollout(file, events, manualCandidates, injections, cwdBySession);
  }
  // Global user-input history ($skill lines). CLI sessions land here; Codex
  // Desktop sessions often do not, which is why rollout user_message rows are
  // collected as well and merged via the time-window dedup below.
  manualCandidates.push(...(await collectHistoryCandidates(join(root, 'history.jsonl'), cwdBySession)));

  // Merge manual signals: the same keystroke can appear in both history.jsonl
  // and the rollout, with timestamps a moment apart.
  const manual = dedupByWindow(manualCandidates, MANUAL_DEDUP_WINDOW_MS);
  const manualTimes = new Map<string, number[]>();
  for (const candidate of manual) {
    events.push(toEvent(candidate, 'manual', false));
    const key = `${candidate.sessionId}|${candidate.skill}`;
    const times = manualTimes.get(key) ?? [];
    times.push(Date.parse(candidate.timestamp));
    manualTimes.set(key, times);
  }

  // Manual $invocations also inject the skill into the rollout; only injections
  // with no nearby manual event in the same session are genuine auto-loads.
  // Resume/fork replays re-emit injection rows with their original timestamps;
  // a global (skill, second) key collapses them.
  const seen = new Set<string>();
  for (const injection of injections) {
    const dedupKey = `${injection.skill}|${injection.timestamp.slice(0, 19)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const times = manualTimes.get(`${injection.sessionId}|${injection.skill}`);
    const ts = Date.parse(injection.timestamp);
    if (times?.some(t => Math.abs(t - ts) <= MANUAL_ECHO_WINDOW_MS)) continue;
    events.push(toEvent(injection, 'auto', false));
  }

  return { events, filesScanned: files.length + 1 };
}

function toEvent(candidate: Candidate, mode: 'manual' | 'auto', inferred: boolean): InvocationEvent {
  return {
    skill: candidate.skill,
    fullName: candidate.fullName,
    mode,
    inferred,
    source: 'codex',
    timestamp: candidate.timestamp,
    sessionId: candidate.sessionId,
    cwd: candidate.cwd,
    sidechain: false,
  };
}

function dedupByWindow(candidates: Candidate[], windowMs: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const lastAccepted = new Map<string, number>();
  const out: Candidate[] = [];
  for (const candidate of sorted) {
    const key = `${candidate.sessionId}|${candidate.skill}`;
    const ts = Date.parse(candidate.timestamp);
    const last = lastAccepted.get(key);
    if (last !== undefined && ts - last <= windowMs) continue;
    lastAccepted.set(key, ts);
    out.push(candidate);
  }
  return out;
}

async function listJsonl(dir: string): Promise<string[]> {
  try {
    const dirents = await readdir(dir, { recursive: true, withFileTypes: true });
    return dirents
      .filter(d => d.isFile() && d.name.endsWith('.jsonl'))
      .map(d => join(d.parentPath, d.name));
  } catch {
    return [];
  }
}

async function parseRollout(
  file: string,
  events: InvocationEvent[],
  manualCandidates: Candidate[],
  injections: Candidate[],
  cwdBySession: Map<string, string>,
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  let sessionId = '';
  let cwd = '';

  for await (const line of rl) {
    const mayMeta = line.includes('"session_meta"');
    const mayInjection = line.includes('<skill>');
    const maySkillMd = line.includes('SKILL.md');
    const mayManual = line.includes('"$');
    if (!mayMeta && !mayInjection && !maySkillMd && !mayManual) continue;

    let row: RolloutRow;
    try {
      row = JSON.parse(line) as RolloutRow;
    } catch {
      continue;
    }
    const payload = row.payload;
    if (!payload) continue;

    if (row.type === 'session_meta') {
      if (typeof payload.id === 'string') {
        sessionId = payload.id;
        if (typeof payload.cwd === 'string') {
          cwd = payload.cwd;
          cwdBySession.set(sessionId, cwd);
        }
      }
      continue;
    }
    if (typeof row.timestamp !== 'string') continue;
    const base = { timestamp: row.timestamp, sessionId, cwd };

    if (payload.type === 'user_message' && typeof payload.message === 'string') {
      // The user typed "$skill" (covers Codex Desktop, which skips history.jsonl).
      const match = MANUAL_SKILL_RE.exec(payload.message);
      if (match?.[1]) {
        manualCandidates.push({ ...base, fullName: match[1], skill: normalizeSkillName(match[1]) });
      }
    } else if (payload.type === 'message' && payload.role === 'user' && Array.isArray(payload.content)) {
      for (const item of payload.content) {
        if (typeof item !== 'object' || item === null) continue;
        const block = item as { type?: string; text?: string };
        if (block.type !== 'input_text' || typeof block.text !== 'string') continue;
        const injection = INJECTION_RE.exec(block.text);
        if (injection?.[1]) {
          const fullName = injection[1].trim();
          injections.push({ ...base, fullName, skill: normalizeSkillName(fullName) });
          continue;
        }
        const manual = MANUAL_SKILL_RE.exec(block.text);
        if (manual?.[1]) {
          manualCandidates.push({ ...base, fullName: manual[1], skill: normalizeSkillName(manual[1]) });
        }
      }
    } else if (payload.type === 'function_call' && typeof payload.arguments === 'string') {
      // Heuristic: the agent read a SKILL.md via exec/shell.
      const match = SKILL_MD_PATH_RE.exec(payload.arguments);
      if (match?.[1]) {
        events.push(toEvent({ ...base, fullName: match[1], skill: normalizeSkillName(match[1]) }, 'auto', true));
      }
    }
  }
}

async function collectHistoryCandidates(
  historyFile: string,
  cwdBySession: Map<string, string>,
): Promise<Candidate[]> {
  let raw: string;
  try {
    raw = await readFile(historyFile, 'utf8');
  } catch {
    return [];
  }

  const candidates: Candidate[] = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('"text":"$')) continue;
    let row: { session_id?: string; ts?: number; text?: string };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row.text !== 'string' || typeof row.ts !== 'number') continue;
    const match = MANUAL_SKILL_RE.exec(row.text);
    if (!match?.[1]) continue;
    const sessionId = typeof row.session_id === 'string' ? row.session_id : '';
    candidates.push({
      fullName: match[1],
      skill: normalizeSkillName(match[1]),
      timestamp: new Date(row.ts * 1000).toISOString(),
      sessionId,
      cwd: cwdBySession.get(sessionId) ?? '',
    });
  }
  return candidates;
}
