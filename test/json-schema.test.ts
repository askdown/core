import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { type Form, parse, responseSchema, validateResponse } from '../src/index.ts';

const dir = fileURLToPath(new URL('../vendor/spec/examples/', import.meta.url));
const example = (name: string) => parse(readFileSync(`${dir}${name}.ask`, 'utf8')).form;
const compile = (form: Form) =>
  new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(responseSchema(form));
const form = (source: string) => parse(source).form;

describe('responseSchema', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.ask')))('compiles for %s', (file) => {
    expect(() => compile(example(file.slice(0, -'.ask'.length)))).not.toThrow();
  });

  it('accepts a normalized response', () => {
    const rsvp = example('rsvp');
    const result = validateResponse(rsvp, {
      'full-name': ' Ada ',
      email: 'ada@example.com',
      'will-you-attend': 'Yes',
      'which-days': ['Day 2', 'Day 1', 'Friday'],
      't-shirt-size': 'M',
      'how-excited-are-you': '4',
      'rate-the-sessions': { Keynote: 'Great' },
    });
    expect(result.valid).toBe(true);
    const validate = compile(rsvp);
    expect(validate(result.answers)).toBe(true);
  });

  it('rejects answers the validator rejects', () => {
    const validate = compile(example('rsvp'));
    const base = { 'full-name': 'Ada', email: 'ada@example.com', 'will-you-attend': 'Yes' };
    expect(validate(base)).toBe(true);
    expect(validate({ ...base, 'will-you-attend': 'Maybe' })).toBe(false);
    expect(validate({ ...base, 'which-days': ['Day 1', 'Friday', 'Saturday'] })).toBe(false);
    expect(validate({ ...base, 'how-excited-are-you': 6 })).toBe(false);
    expect(validate({ ...base, 'rate-the-sessions': { Lunch: 'OK' } })).toBe(false);
    expect(validate({ ...base, unknown: 'x' })).toBe(false);
    expect(validate({ email: 'ada@example.com', 'will-you-attend': 'Yes' })).toBe(false);
  });

  it('only requires questions on pages every respondent visits', () => {
    const schema = responseSchema(example('branching'));
    expect(schema.required).toEqual(['what-do-you-need-help-with']);
    expect(responseSchema(example('rsvp')).required).toEqual(['full-name', 'email', 'will-you-attend']);
  });

  it('treats pages after a jump target as always visited when all paths lead there', () => {
    const schema = responseSchema(
      form('? A *\n- ( ) X -> #b\n- ( ) Y\n\n--- {#a}\n\n? B *\n___\n\n--- {#b}\n\n? C *\n___'),
    );
    expect(schema.required).toEqual(['a', 'c']);
  });

  it('stops at pages that would be visited twice', () => {
    const schema = responseSchema(form('--- {#a}\n\n? A *\n___\n\n--- {#b}\n\n? B *\n- ( ) X -> #a\n- ( ) Y\n\n--- {#c}\n\n? C *\n___'));
    expect(schema.required).toEqual(['a', 'b']);
  });

  it('anchors text patterns', () => {
    const validate = compile(form('? A\n[text pattern="\\d+|x"]'));
    expect(validate({ a: 'x' })).toBe(true);
    expect(validate({ a: '12' })).toBe(true);
    expect(validate({ a: '12x' })).toBe(false);
  });

  it('allows an other answer for radio', () => {
    const validate = compile(form('? A\n- ( ) X\n- ( ) Other: ___'));
    expect(validate({ a: 'X' })).toBe(true);
    expect(validate({ a: 'Something' })).toBe(true);
    expect(validate({ a: '' })).toBe(false);
  });

  it('describes rankings', () => {
    const validate = compile(form('? A\n1. X\n2. Y\n3. Z'));
    expect(validate({ a: ['Z', 'X', 'Y'] })).toBe(true);
    expect(validate({ a: ['Z', 'X'] })).toBe(false);
    expect(validate({ a: ['Z', 'X', 'X'] })).toBe(false);
    expect(validate({ a: ['Z', 'X', 'W'] })).toBe(false);
  });

  it('describes phone numbers', () => {
    const validate = compile(form('? A\n[phone]'));
    expect(validate({ a: '+31612345678' })).toBe(true);
    expect(validate({ a: '0612345678' })).toBe(false);
    expect(validate({ a: '+0123456789' })).toBe(false);
  });

  it('describes addresses', () => {
    const validate = compile(form('? A\n[address]\n\n? B\n[address country=NL]\n\n? C\n[address country=CA]'));
    const us = { street: 'Main St 1', city: 'Springfield', region: 'IL', postalCode: '62701', country: 'US' };
    const nl = { street: 'Keizersgracht 1', city: 'Amsterdam', postalCode: '1015 AA', country: 'NL' };
    expect(validate({ a: us })).toBe(true);
    expect(validate({ a: nl })).toBe(true);
    expect(validate({ a: { street: 'Rua 1', city: 'Luanda', country: 'AO' } })).toBe(true);
    expect(validate({ a: { ...us, country: 'XY' } })).toBe(false);
    expect(validate({ a: { ...us, region: 'XX' } })).toBe(false);
    expect(validate({ a: { ...us, postalCode: undefined } })).toBe(false);
    expect(validate({ a: { ...nl, region: 'Noord-Holland' } })).toBe(false);
    expect(validate({ b: nl })).toBe(true);
    expect(validate({ b: us })).toBe(false);
    expect(validate({ c: { street: '1 King St W', city: 'Toronto', region: 'ON', postalCode: 'M5V 2T6', country: 'CA' } })).toBe(true);
    expect(validate({ c: { street: '1 King St W', city: 'Toronto', postalCode: 'M5V 2T6', country: 'CA' } })).toBe(false);
    expect(validate({ c: { street: '1 King St W', city: 'Toronto', region: 'ON', postalCode: 'm5v2t6', country: 'CA' } })).toBe(false);
    expect(validate({ a: { ...us, postalCode: '6270' } })).toBe(false);
  });

  it('limits files', () => {
    const validate = compile(form('? A\n[file maxsize=1KB maxfiles=2]'));
    const file = { name: 'a.txt', size: 10, type: 'text/plain', uri: 'data:,a' };
    expect(validate({ a: [file, file] })).toBe(true);
    expect(validate({ a: [file, file, file] })).toBe(false);
    expect(validate({ a: [{ ...file, size: 5000 }] })).toBe(false);
  });

  it('sets $id and titles', () => {
    const schema = responseSchema(example('rsvp'), { id: 'https://example.com/f/x/schema.json' });
    expect(schema.$id).toBe('https://example.com/f/x/schema.json');
    expect(schema.title).toBe('DevConf RSVP');
    expect((schema.properties as Record<string, unknown>).email).toMatchObject({
      title: 'Email',
      description: "We'll only use this for event updates.",
    });
  });
});
