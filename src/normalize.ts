/**
 * Normalize a skill/command name for aggregation:
 * - strip a leading slash
 * - collapse consecutive duplicate namespace segments
 *   ("frontend-design:frontend-design" -> "frontend-design",
 *    "lovstudio:lovstudio:git:commit" -> "lovstudio:git:commit")
 */
export function normalizeSkillName(raw: string): string {
  const name = raw.trim().replace(/^\//, '');
  const segments = name
    .split(':')
    .map(s => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const segment of segments) {
    if (out[out.length - 1] !== segment) out.push(segment);
  }
  return out.join(':');
}
