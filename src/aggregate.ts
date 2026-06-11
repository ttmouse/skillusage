import type { InvocationEvent } from './types.js';

export interface SkillStats {
  skill: string;
  total: number;
  manual: number;
  auto: number;
  /** Subset of `auto` that came from heuristic signals (SKILL.md reads). */
  inferredAuto: number;
  lastUsedAt: string | null;
  /** Source ("claude" | "codex") -> count. */
  sources: Record<string, number>;
  /** Local-timezone YYYY-MM-DD -> count. */
  daily: Record<string, number>;
  /** cwd -> count. */
  projects: Record<string, number>;
  /** Raw on-disk names that normalized to this skill. */
  aliases: string[];
}

export interface AggregateOptions {
  /** Only count invocations from the last N days. */
  days?: number;
  /** Include subagent sidechain events. */
  includeSubagents?: boolean;
  /** Drop heuristic (inferred) auto signals. */
  strict?: boolean;
}

export interface AggregateResult {
  skills: SkillStats[];
  totals: { invocations: number; manual: number; auto: number; skills: number };
}

export function aggregate(events: InvocationEvent[], opts: AggregateOptions = {}): AggregateResult {
  const cutoff = opts.days && opts.days > 0 ? Date.now() - opts.days * 86_400_000 : null;
  const kept = events.filter(event => {
    if (event.sidechain && !opts.includeSubagents) return false;
    if (event.inferred && opts.strict) return false;
    if (cutoff !== null && Date.parse(event.timestamp) < cutoff) return false;
    return true;
  });

  // Pass 1 — explicit signals. Dedup: same skill in the same session within
  // the same second is one invocation.
  const byKey = new Map<string, InvocationEvent>();
  const explicitSessionSkills = new Set<string>();
  for (const event of kept) {
    if (event.inferred) continue;
    const key = `${event.sessionId}|${event.skill}|${event.timestamp.slice(0, 19)}`;
    if (!byKey.has(key)) byKey.set(key, event);
    explicitSessionSkills.add(`${event.sessionId}|${event.skill}`);
  }

  // Pass 2 — inferred signals (SKILL.md reads). The agent often reads a skill
  // file in chunks, so an inferred signal counts at most once per session and
  // is suppressed entirely when the same session already has an explicit one.
  for (const event of kept) {
    if (!event.inferred) continue;
    const sessionKey = `${event.sessionId}|${event.skill}`;
    if (explicitSessionSkills.has(sessionKey)) continue;
    const key = `${sessionKey}|inferred`;
    if (!byKey.has(key)) byKey.set(key, event);
  }

  const bySkill = new Map<string, SkillStats & { aliasSet: Set<string> }>();
  for (const event of byKey.values()) {
    let stats = bySkill.get(event.skill);
    if (!stats) {
      stats = {
        skill: event.skill,
        total: 0,
        manual: 0,
        auto: 0,
        inferredAuto: 0,
        lastUsedAt: null,
        sources: {},
        daily: {},
        projects: {},
        aliases: [],
        aliasSet: new Set<string>(),
      };
      bySkill.set(event.skill, stats);
    }
    stats.total += 1;
    if (event.mode === 'manual') stats.manual += 1;
    else {
      stats.auto += 1;
      if (event.inferred) stats.inferredAuto += 1;
    }
    if (!stats.lastUsedAt || event.timestamp > stats.lastUsedAt) stats.lastUsedAt = event.timestamp;
    stats.sources[event.source] = (stats.sources[event.source] ?? 0) + 1;
    const day = localDateKey(event.timestamp);
    stats.daily[day] = (stats.daily[day] ?? 0) + 1;
    if (event.cwd) stats.projects[event.cwd] = (stats.projects[event.cwd] ?? 0) + 1;
    stats.aliasSet.add(event.fullName);
  }

  const skills = [...bySkill.values()]
    .map(({ aliasSet, ...stats }) => ({ ...stats, aliases: [...aliasSet].sort() }))
    .sort((a, b) => b.total - a.total || a.skill.localeCompare(b.skill));

  const totals = skills.reduce(
    (acc, s) => {
      acc.invocations += s.total;
      acc.manual += s.manual;
      acc.auto += s.auto;
      return acc;
    },
    { invocations: 0, manual: 0, auto: 0, skills: skills.length },
  );

  return { skills, totals };
}

function localDateKey(timestamp: string): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
