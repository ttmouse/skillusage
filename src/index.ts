#!/usr/bin/env node
import { cli, define } from 'gunshi';
import { collectClaudeEvents } from './adapters/claude.js';
import { aggregate } from './aggregate.js';
import { renderTable } from './render/table.js';

const command = define({
  name: 'skillusage',
  description: 'Skill / slash-command usage analytics for Claude Code, parsed from local on-disk data',
  args: {
    json: {
      type: 'boolean',
      description: 'Output machine-readable JSON',
    },
    days: {
      type: 'number',
      short: 'd',
      description: 'Only count invocations from the last N days',
    },
    limit: {
      type: 'number',
      short: 'l',
      default: 25,
      description: 'Max rows in the table (0 = all)',
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
  },
  run: async ctx => {
    const started = performance.now();
    const scan = await collectClaudeEvents(ctx.values['claude-dir']);
    const result = aggregate(scan.events, {
      days: ctx.values.days,
      strict: ctx.values.strict,
      includeSubagents: ctx.values['include-subagents'],
    });
    const elapsedMs = performance.now() - started;

    if (ctx.values.json) {
      console.log(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            source: 'claude',
            windowDays: ctx.values.days ?? null,
            filesScanned: scan.filesScanned,
            totals: result.totals,
            skills: result.skills,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      renderTable(result, {
        limit: ctx.values.limit ?? 25,
        filesScanned: scan.filesScanned,
        elapsedMs,
        days: ctx.values.days,
      }),
    );
  },
});

await cli(process.argv.slice(2), command, {
  name: 'skillusage',
  version: '0.1.0',
  description: 'Skill / slash-command usage analytics for Claude Code and Codex',
});
