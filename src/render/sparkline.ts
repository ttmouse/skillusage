const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Render counts as a block-character sparkline; zero renders as a space. */
export function sparkline(values: number[]): string {
  const max = Math.max(...values, 1);
  return values
    .map(v => (v <= 0 ? ' ' : BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((v / max) * BLOCKS.length))]))
    .join('');
}

/** Local-timezone YYYY-MM-DD keys for the last `n` days, oldest first. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${d.getFullYear()}-${month}-${day}`);
  }
  return out;
}
