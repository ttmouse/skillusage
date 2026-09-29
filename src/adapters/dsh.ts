import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { normalizeSkillName } from '../normalize.js';
import { SKILL_MD_PATH_RE } from './skill-md.js';

/**
 * DSH sessions are zstd-compressed JSONL. Newer sessions carry a dedicated
 * `skill` tool row (explicit); everything else leaves only SKILL.md paths
 * inside tool-call arguments (inferred). The same call can appear both as an
 * assistant/message part and as its own tool/call row — callId dedups them.
 */
interface DshRow {
  type?: string;
  time?: number;
  data?: {
    id?: unknown;
    cwd?: unknown;
    callId?: unknown;
    name?: unknown;
    arguments?: unknown;
    message?: {
      content?: unknown;
    };
  };
}

interface CallCandidate {
  id: string;
  name: string;
  arguments: string;
  timestamp: string;
}

export async function collectDshEvents(dshDir?: string): Promise<ScanResult> {
  const sessionsDir = join(dshDir ?? join(homedir(), '.dsh'), 'sessions');
  let files: string[] = [];
  try {
    const dirents = await readdir(sessionsDir, { recursive: true, withFileTypes: true });
    files = dirents
      .filter(d => d.isFile() && d.name.endsWith('.jsonl.zstd'))
      .map(d => join(d.parentPath, d.name));
  } catch {
    return { events: [], filesScanned: 0 };
  }

  const events: InvocationEvent[] = [];
  const seenCallIds = new Set<string>();
  let warnedZstd = false;

  for (const file of files) {
    await parseSession(file, events, seenCallIds, ok => {
      if (!ok && !warnedZstd) {
        warnedZstd = true;
        console.error('skillusage: zstd CLI not found; skipping dsh source');
      }
    });
  }
  return { events, filesScanned: files.length };
}

async function parseSession(
  file: string,
  events: InvocationEvent[],
  seenCallIds: Set<string>,
  reportZstd: (available: boolean) => void,
): Promise<void> {
  const child = spawn('zstd', ['-dc', file], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('error', () => reportZstd(false));

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

  let sessionId = '';
  let cwd = '';

  rl.on('close', () => child.kill());

  for await (const line of rl) {
    const mayCall = line.includes('tool-call') || line.includes('tool/call');
    if (!mayCall && !line.includes('"session"')) continue;

    let row: DshRow;
    try {
      row = JSON.parse(line) as DshRow;
    } catch {
      continue;
    }
    const data = row.data;
    if (!data || typeof data !== 'object') continue;

    if (row.type === 'session') {
      if (typeof data.id === 'string') sessionId = data.id;
      if (typeof data.cwd === 'string') cwd = data.cwd;
      continue;
    }
    if (typeof row.time !== 'number') continue;
    const timestamp = new Date(row.time).toISOString();

    if (row.type === 'tool/call') {
      const candidate = toCandidate(data, timestamp);
      if (candidate) pushCandidate(candidate, sessionId, cwd, events, seenCallIds);
    } else if (row.type === 'assistant/message') {
      const content = data.message?.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (typeof item !== 'object' || item === null) continue;
        const part = item as { type?: string; id?: unknown; name?: unknown; arguments?: unknown };
        if (part.type !== 'tool-call') continue;
        const candidate = toCandidate(part, timestamp);
        if (candidate) pushCandidate(candidate, sessionId, cwd, events, seenCallIds);
      }
    }
  }
}

function toCandidate(
  data: { callId?: unknown; id?: unknown; name?: unknown; arguments?: unknown },
  timestamp: string,
): CallCandidate | null {
  if (typeof data.name !== 'string') return null;
  return {
    id: typeof data.callId === 'string' ? data.callId : typeof data.id === 'string' ? data.id : '',
    name: data.name,
    arguments: typeof data.arguments === 'string' ? data.arguments : '',
    timestamp,
  };
}

function pushCandidate(
  candidate: CallCandidate,
  sessionId: string,
  cwd: string,
  events: InvocationEvent[],
  seenCallIds: Set<string>,
): void {
  if (candidate.id) {
    if (seenCallIds.has(candidate.id)) return;
    seenCallIds.add(candidate.id);
  }

  if (candidate.name === 'skill') {
    let name: unknown;
    try {
      name = JSON.parse(candidate.arguments)?.name;
    } catch {
      return;
    }
    if (typeof name !== 'string' || !name) return;
    events.push(event(name, false, candidate, sessionId, cwd));
    return;
  }

  const match = SKILL_MD_PATH_RE.exec(candidate.arguments);
  if (match?.[1]) events.push(event(match[1], true, candidate, sessionId, cwd));
}

function event(
  fullName: string,
  inferred: boolean,
  candidate: CallCandidate,
  sessionId: string,
  cwd: string,
): InvocationEvent {
  return {
    skill: normalizeSkillName(fullName),
    fullName,
    mode: 'auto',
    inferred,
    source: 'dsh',
    timestamp: candidate.timestamp,
    sessionId,
    cwd,
    sidechain: false,
  };
}
