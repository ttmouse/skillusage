import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent, ScanResult } from '../types.js';
import { BUILTIN_COMMANDS } from '../builtins.js';
import { normalizeSkillName } from '../normalize.js';

const COMMAND_NAME_RE = /<command-name>\s*\/?([^<\n]+?)\s*<\/command-name>/;
const SKILL_MD_PATH_RE = /\/skills\/([^/\s"']+)\/SKILL\.md/;

interface TranscriptRow {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  message?: {
    content?: unknown;
  };
}

export async function collectClaudeEvents(claudeDir?: string): Promise<ScanResult> {
  const projectsDir = join(claudeDir ?? join(homedir(), '.claude'), 'projects');
  let files: string[] = [];
  try {
    const dirents = await readdir(projectsDir, { recursive: true, withFileTypes: true });
    files = dirents
      .filter(d => d.isFile() && d.name.endsWith('.jsonl'))
      .map(d => join(d.parentPath, d.name));
  } catch {
    return { events: [], filesScanned: 0 };
  }

  const events: InvocationEvent[] = [];
  for (const file of files) {
    await parseTranscript(file, events);
  }
  return { events, filesScanned: files.length };
}

async function parseTranscript(file: string, events: InvocationEvent[]): Promise<void> {
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // Cheap substring prefilter before paying for JSON.parse.
    const maySkillTool = line.includes('"Skill"');
    const mayCommand = line.includes('<command-name>');
    const maySkillMd = line.includes('SKILL.md');
    if (!maySkillTool && !mayCommand && !maySkillMd) continue;

    let row: TranscriptRow;
    try {
      row = JSON.parse(line) as TranscriptRow;
    } catch {
      continue;
    }
    if (typeof row.timestamp !== 'string') continue;

    const base = {
      source: 'claude' as const,
      timestamp: row.timestamp,
      sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
      cwd: typeof row.cwd === 'string' ? row.cwd : '',
      sidechain: row.isSidechain === true,
    };

    if (row.type === 'assistant' && Array.isArray(row.message?.content)) {
      collectAssistantToolUses(row.message.content, base, events);
    } else if (row.type === 'user' && mayCommand && row.message) {
      collectSlashCommand(row.message.content, base, events);
    }
  }
}

type EventBase = Omit<InvocationEvent, 'skill' | 'fullName' | 'mode' | 'inferred'>;

function collectAssistantToolUses(content: unknown[], base: EventBase, events: InvocationEvent[]): void {
  for (const item of content) {
    if (typeof item !== 'object' || item === null) continue;
    const block = item as { type?: string; name?: string; input?: Record<string, unknown> };
    if (block.type !== 'tool_use' || !block.input) continue;

    if (block.name === 'Skill' && typeof block.input.skill === 'string') {
      // Explicit agent-initiated Skill tool call.
      const fullName = block.input.skill;
      events.push({ ...base, fullName, skill: normalizeSkillName(fullName), mode: 'auto', inferred: false });
    } else if (block.name === 'Read' || block.name === 'Bash') {
      // Heuristic: the agent read a SKILL.md, i.e. an auto-triggered skill.
      const target = block.name === 'Read' ? block.input.file_path : block.input.command;
      if (typeof target !== 'string') continue;
      const match = SKILL_MD_PATH_RE.exec(target);
      if (!match || !match[1]) continue;
      events.push({ ...base, fullName: match[1], skill: normalizeSkillName(match[1]), mode: 'auto', inferred: true });
    }
  }
}

function collectSlashCommand(content: unknown, base: EventBase, events: InvocationEvent[]): void {
  const text = extractText(content);
  if (!text) return;
  // Real invocations start with the command tags; this guards against
  // transcripts that merely *talk about* <command-name>.
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('<command-message>') && !trimmed.startsWith('<command-name>')) return;

  const match = COMMAND_NAME_RE.exec(text);
  if (!match || !match[1]) return;
  const fullName = match[1].replace(/^\//, '');
  if (BUILTIN_COMMANDS.has(fullName)) return;
  events.push({ ...base, fullName, skill: normalizeSkillName(fullName), mode: 'manual', inferred: false });
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  let text = '';
  for (const item of content) {
    if (typeof item === 'object' && item !== null) {
      const block = item as { type?: string; text?: string };
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    }
  }
  return text || null;
}
