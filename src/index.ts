#!/usr/bin/env node
import { cli, define } from 'gunshi';
import { collectClaudeEvents } from './adapters/claude.js';
import { collectCodexEvents } from './adapters/codex.js';
import { aggregate, type AggregateResult } from './aggregate.js';
import { renderDaily } from './render/daily.js';
import { renderTable } from './render/table.js';
import type { InvocationEvent } from './types.js';

const VERSION = '0.1.0';

const sharedArgs = {
  json: {
    type: 'boolean',
    description: 'Output machine-readable JSON',
  },
  days: {
    type: 'number',
    short: 'd',
    description: 'Only count invocations from the last N days',
  },
  source: {
    type: 'string',
    short: 's',
    default: 'all',
    description: 'Data source: claude | codex | all',
  },
  strict: {
    type: 'boolean',
    description: 'Exclude inferred auto-invocations (SKILL.md read heuristic)',
  },
  'include-subagents': {
    type: 'boolean',
    description: 'Include invocations made inside subagent sidechains',
  },
  'claude-dir': {
    type: 'string',
    description: 'Override the Claude data directory (default: ~/.claude)',
  },
  'codex-dir': {
    type: 'string',
    description: 'Override the Codex data directory (default: ~/.codex)',
  },
} as const;

interface SharedValues {
  json?: boolean;
  days?: number;
  source?: string;
  strict?: boolean;
  'include-subagents'?: boolean;
  'claude-dir'?: string;
  'codex-dir'?: string;
}

interface ScanOutcome {
  result: AggregateResult;
  filesScanned: number;
  elapsedMs: number;
  source: string;
}

async function scanAndAggregate(values: SharedValues, days?: number): Promise<ScanOutcome> {
  const source = values.source === 'claude' || values.source === 'codex' ? values.source : 'all';
  const started = performance.now();

  const events: InvocationEvent[] = [];
  let filesScanned = 0;
  const scans = await Promise.all([
    source !== 'codex' ? collectClaudeEvents(values['claude-dir']) : null,
    source !== 'claude' ? collectCodexEvents(values['codex-dir']) : null,
  ]);
  for (const scan of scans) {
    if (!scan) continue;
    events.push(...scan.events);
    filesScanned += scan.filesScanned;
  }

  const result = aggregate(events, {
    days,
    strict: values.strict,
    includeSubagents: values['include-subagents'],
  });
  return { result, filesScanned, elapsedMs: performance.now() - started, source };
}

function printJson(outcome: ScanOutcome, windowDays: number | null): void {
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: outcome.source,
        windowDays,
        filesScanned: outcome.filesScanned,
        totals: outcome.result.totals,
        skills: outcome.result.skills,
      },
      null,
      2,
    ),
  );
}

const mainCommand = define({
  name: 'skillusage',
  description: 'Top skills by invocation count (use the "daily" subcommand for per-day trends)',
  args: {
    ...sharedArgs,
    limit: {
      type: 'number',
      short: 'l',
      default: 25,
      description: 'Max rows in the table (0 = all)',
    },
  },
  run: async ctx => {
    const outcome = await scanAndAggregate(ctx.values, ctx.values.days);
    if (ctx.values.json) {
      printJson(outcome, ctx.values.days ?? null);
      return;
    }
    console.log(
      renderTable(outcome.result, {
        limit: ctx.values.limit ?? 25,
        filesScanned: outcome.filesScanned,
        elapsedMs: outcome.elapsedMs,
        days: ctx.values.days,
        source: outcome.source,
      }),
    );
  },
});

const dailyCommand = define({
  name: 'daily',
  description: 'Per-day invocation counts with a sparkline trend',
  args: sharedArgs,
  run: async ctx => {
    const days = ctx.values.days && ctx.values.days > 0 ? ctx.values.days : 30;
    const outcome = await scanAndAggregate(ctx.values, days);
    if (ctx.values.json) {
      printJson(outcome, days);
      return;
    }
    console.log(
      renderDaily(outcome.result, {
        days,
        filesScanned: outcome.filesScanned,
        elapsedMs: outcome.elapsedMs,
        source: outcome.source,
      }),
    );
  },
});

// Manual dispatch instead of gunshi subCommands: with subCommands enabled,
// gunshi resolves the first bare token ("--source codex") as a command name.
const argv = process.argv.slice(2);
const isDaily = argv[0] === 'daily';
await cli(isDaily ? argv.slice(1) : argv, isDaily ? dailyCommand : mainCommand, {
  name: 'skillusage',
  version: VERSION,
  description: 'Skill / slash-command usage analytics for Claude Code and Codex',
});
