import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { normalizeSkillName } from '../normalize.js';
import { SKILL_MD_PATH_RE } from './skill-md.js';

const SKILL_MD_TOOLS = new Set(['Read', 'Execute', 'Bash']);

interface FactoryRow {
  type?: string;
  id?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

export async function collectFactoryEvents(factoryDir?: string): Promise<ScanResult> {
  const sessionsDir = join(factoryDir ?? join(homedir(), '.factory'), 'sessions');
  let files: string[] = [];
  try {
    const dirents = await readdir(sessionsDir, { recursive: true, withFileTypes: true });
    files = dirents
      .filter(d => d.isFile() && d.name.endsWith('.jsonl'))
      .map(d => join(d.parentPath, d.name));
  } catch {
    return { events: [], filesScanned: 0 };
  }

  const events: InvocationEvent[] = [];
  for (const file of files) {
    await parseSession(file, events);
  }
  return { events, filesScanned: files.length };
}

async function parseSession(file: string, events: InvocationEvent[]): Promise<void> {
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  // session_start rows carry no timestamp; they only identify the session.
  let sessionId = '';
  let cwd = '';

  for await (const line of rl) {
    const maySkillTool = line.includes('"Skill"');
    const maySkillMd = line.includes('SKILL.md');
    if (!maySkillTool && !maySkillMd) continue;

    let row: FactoryRow;
    try {
      row = JSON.parse(line) as FactoryRow;
    } catch {
      continue;
    }

    if (row.type === 'session_start') {
      if (typeof row.id === 'string') sessionId = row.id;
      if (typeof row.cwd === 'string') cwd = row.cwd;
      continue;
    }
    if (row.type !== 'message' || typeof row.timestamp !== 'string') continue;

    const content = row.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue;
      const block = item as { type?: string; name?: string; input?: Record<string, unknown> };
      if (block.type !== 'tool_use' || !block.input) continue;

      if (block.name === 'Skill' && typeof block.input.skill === 'string') {
        events.push({
          skill: normalizeSkillName(block.input.skill),
          fullName: block.input.skill,
          mode: 'auto',
          inferred: false,
          source: 'factory',
          timestamp: row.timestamp,
          sessionId,
          cwd,
          sidechain: false,
        });
      } else if (SKILL_MD_TOOLS.has(block.name ?? '')) {
        const match = SKILL_MD_PATH_RE.exec(JSON.stringify(block.input));
        if (match?.[1]) {
          events.push({
            skill: normalizeSkillName(match[1]),
            fullName: match[1],
            mode: 'auto',
            inferred: true,
            source: 'factory',
            timestamp: row.timestamp,
            sessionId,
            cwd,
            sidechain: false,
          });
        }
      }
    }
  }
}
