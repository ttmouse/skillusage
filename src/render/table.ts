import Table from 'cli-table3';
import pc from 'picocolors';
import type { AggregateResult } from '../aggregate.js';

export interface RenderOptions {
  limit: number;
  filesScanned: number;
  elapsedMs: number;
  days?: number;
}

export function renderTable(result: AggregateResult, opts: RenderOptions): string {
  const rows = opts.limit > 0 ? result.skills.slice(0, opts.limit) : result.skills;

  const table = new Table({
    head: ['#', 'Skill', 'Total', 'Manual', 'Auto', 'Last used'].map(h => pc.bold(h)),
    style: { head: [], border: [] },
    colAligns: ['right', 'left', 'right', 'right', 'right', 'left'],
  });

  rows.forEach((s, i) => {
    const auto =
      s.inferredAuto > 0 ? `${s.auto} ${pc.dim(`(~${s.inferredAuto})`)}` : String(s.auto);
    table.push([
      pc.dim(String(i + 1)),
      s.skill,
      pc.bold(String(s.total)),
      String(s.manual),
      auto,
      s.lastUsedAt ? pc.dim(s.lastUsedAt.slice(0, 10)) : pc.dim('-'),
    ]);
  });

  const lines: string[] = [table.toString()];
  const hidden = result.skills.length - rows.length;
  if (hidden > 0) lines.push(pc.dim(`  ... and ${hidden} more skills (use --limit 0 to show all)`));
  const window = opts.days ? `last ${opts.days}d` : 'all time';
  lines.push(
    pc.dim(
      `  ${result.totals.invocations} invocations · ${result.totals.manual} manual / ${result.totals.auto} auto · ` +
        `${result.totals.skills} skills · ${window} · ${opts.filesScanned} transcripts in ${(opts.elapsedMs / 1000).toFixed(1)}s`,
    ),
  );
  lines.push(pc.dim('  (~n) = inferred auto-invocations via SKILL.md reads; exclude with --strict'));
  return lines.join('\n');
}
