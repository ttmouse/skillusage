import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { normalizeSkillName } from '../normalize.js';
import { SKILL_MD_PATH_NESTED_RE } from './skill-md.js';
import { cindyPiSessionsDir } from './cindy-paths.js';

/**
 * Pi has no dedicated Skill tool (toolCalls are bash/read/edit/write), so a
 * trigger only shows up as a SKILL.md path inside toolCall arguments — or as
 * an activation marker line ("✓ auto (user) ~/.agents/skills/.../SKILL.md")
 * in text parts. Both surface as inferred auto-invocations.
 */
interface PiRow {
  type?: string;
  id?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    content?: unknown;
  };
}

export async function collectPiEvents(piDir?: string): Promise<ScanResult> {
  const roots = [
    join(piDir ?? join(homedir(), '.pi'), 'agent', 'sessions'),
    cindyPiSessionsDir(),
  ];

  const events: InvocationEvent[] = [];
  let filesScanned = 0;
  for (const root of roots) {
    const files = await listJsonl(root);
    filesScanned += files.length;
    for (const file of files) {
      await parseSession(file, events);
    }
  }
  return { events, filesScanned };
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

async function parseSession(file: string, events: InvocationEvent[]): Promise<void> {
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  let sessionId = '';
  let cwd = '';

  for await (const line of rl) {
    if (!line.includes('SKILL.md')) continue;

    let row: PiRow;
    try {
      row = JSON.parse(line) as PiRow;
    } catch {
      continue;
    }

    if (row.type === 'session') {
      if (typeof row.id === 'string') sessionId = row.id;
      if (typeof row.cwd === 'string') cwd = row.cwd;
      continue;
    }
    if (row.type !== 'message' || typeof row.timestamp !== 'string') continue;

    const content = row.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue;
      const part = item as { type?: string; text?: string; arguments?: unknown };
      // Nested skill directories ("document-skills/docx") are kept as-is;
      // normalizeSkillName passes them through.
      const source = part.type === 'toolCall' ? JSON.stringify(part.arguments ?? {}) : part.text;
      if (typeof source !== 'string') continue;
      const match = SKILL_MD_PATH_NESTED_RE.exec(source);
      if (match?.[1]) {
        events.push({
          skill: normalizeSkillName(match[1]),
          fullName: match[1],
          mode: 'auto',
          inferred: true,
          source: 'pi',
          timestamp: row.timestamp,
          sessionId,
          cwd,
          sidechain: false,
        });
      }
    }
  }
}
