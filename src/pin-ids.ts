import { PAGE_BREAK, parse } from './parse.ts';

/**
 * Adds an explicit {#id} to every question and page in the source that
 * doesn't have one yet, so that later label edits don't change ids.
 *
 * Only the affected lines are modified; everything else is kept as written.
 */
export function pinIds(source: string): string {
  const { locations } = parse(source);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  for (const [id, loc] of Object.entries(locations.questions)) {
    if (loc.explicitId) continue;
    const idx = loc.line - 1;
    lines[idx] = `${lines[idx]!.trimEnd()} {#${id}}`;
  }
  for (const [id, loc] of Object.entries(locations.pages)) {
    if (loc.explicitId) continue;
    const idx = loc.line - 1;
    const line = lines[idx];
    if (line === undefined || !PAGE_BREAK.test(line)) continue;
    lines[idx] = line.replace(/^(---+)/, `$1 {#${id}}`).trimEnd();
  }
  return lines.join(newline);
}
