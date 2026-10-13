import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { type Form, parse, pinIds, serialize, validateForm } from '../src/index.ts';

const dir = fileURLToPath(new URL('../vendor/spec/examples/', import.meta.url));
const schema = JSON.parse(readFileSync(new URL('../vendor/spec/askdown.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);

const names = readdirSync(dir)
  .filter((f) => f.endsWith('.ask'))
  .map((f) => f.slice(0, -'.ask'.length));

describe.each(names)('%s', (name) => {
  const source = readFileSync(`${dir}${name}.ask`, 'utf8');
  const { $schema: _, ...expected } = JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')) as Form & {
    $schema: string;
  };

  it('parses to the JSON fixture without diagnostics', () => {
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.form).toEqual(expected);
  });

  it('JSON fixture conforms to the schema', () => {
    const ok = validate({ $schema: 'x', ...expected });
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(validateForm(expected)).toEqual([]);
  });

  it('round-trips through serialize', () => {
    const text = serialize(expected);
    const reparsed = parse(text);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.form).toEqual(expected);
    // Serializing is stable
    expect(serialize(reparsed.form)).toBe(text);
  });

  it('round-trips with explicit ids', () => {
    const text = serialize(expected, { explicitIds: true });
    const reparsed = parse(text);
    expect(reparsed.form).toEqual(expected);
    expect(Object.values(reparsed.locations.questions).every((l) => l.explicitId)).toBe(true);
  });

  it('pinIds keeps the form the same and makes ids explicit', () => {
    const pinned = pinIds(source);
    const reparsed = parse(pinned);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.form).toEqual(expected);
    expect(Object.values(reparsed.locations.questions).every((l) => l.explicitId)).toBe(true);
    expect(pinIds(pinned)).toBe(pinned);
  });
});
