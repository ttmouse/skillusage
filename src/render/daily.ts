import Table from 'cli-table3';
import pc from 'picocolors';
import type { AggregateResult } from '../aggregate.js';
import { lastNDays, sparkline } from './sparkline.js';

export interface DailyRenderOptions {
  days: number;
  filesScanned: number;
  elapsedMs: number;
  source: string;
}

interface DayBucket {
  total: number;
  topSkill: string;
  topCount: number;
}

export function renderDaily(result: AggregateResult, opts: DailyRenderOptions): string {
  const window = lastNDays(opts.days);
  const buckets = new Map<string, DayBucket>(
    window.map(day => [day, { total: 0, topSkill: '', topCount: 0 }]),
  );

  for (const skill of result.skills) {
    for (const [day, count] of Object.entries(skill.daily)) {
      const bucket = buckets.get(day);
      if (!bucket) continue;
      bucket.total += count;
      if (count > bucket.topCount) {
        bucket.topCount = count;
        bucket.topSkill = skill.skill;
      }
    }
  }

  const counts = window.map(day => buckets.get(day)?.total ?? 0);
  const lines: string[] = [];
  lines.push(`  ${sparkline(counts)}  ${pc.dim(`last ${opts.days}d, max ${Math.max(...counts, 0)}/day`)}`);

  const table = new Table({
    head: ['Date', 'Total', 'Top skill'].map(h => pc.bold(h)),
    style: { head: [], border: [] },
    colAligns: ['left', 'right', 'left'],
  });
  for (const day of [...window].reverse()) {
    const bucket = buckets.get(day);
    if (!bucket || bucket.total === 0) continue;
    table.push([
      day,
      pc.bold(String(bucket.total)),
      bucket.topSkill ? `${bucket.topSkill} ${pc.dim(`(${bucket.topCount})`)}` : pc.dim('-'),
    ]);
  }
  lines.push(table.toString());
  lines.push(
    pc.dim(
      `  ${result.totals.invocations} invocations · ${result.totals.skills} skills · source: ${opts.source} · ` +
        `${opts.filesScanned} files in ${(opts.elapsedMs / 1000).toFixed(1)}s`,
    ),
  );
  return lines.join('\n');
}
