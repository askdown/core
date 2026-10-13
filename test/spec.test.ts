import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from '../src/index.ts';

const spec = readFileSync(new URL('../vendor/spec/askdown.md', import.meta.url), 'utf8');
const examples = [...spec.matchAll(/^```askdown\n([\s\S]*?)^```$/gm)].map((m) => m[1]!);

it('finds examples in the spec', () => {
  expect(examples.length).toBeGreaterThan(5);
});

it.each(examples)('spec example parses without diagnostics: %s', (example) => {
  expect(parse(example).diagnostics).toEqual([]);
});

it('keeps backslashes in quoted patterns', () => {
  const q = parse('? A\n[text pattern="\\d{4} \\"x\\" \\\\"]').form.pages[0]!.items[0];
  expect(q).toMatchObject({ pattern: '\\d{4} "x" \\' });
});
