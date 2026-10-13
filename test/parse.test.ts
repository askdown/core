import { describe, expect, it } from 'vitest';
import { type Form, parse, type Question, serialize } from '../src/index.ts';

const questions = (form: Form) => form.pages.flatMap((p) => p.items).filter((i): i is Question => i.type !== 'content');
const messages = (source: string) => parse(source).diagnostics.map((d) => `${d.line}:${d.severity}:${d.message}`);

describe('parse', () => {
  it('parses an empty document', () => {
    const { form, diagnostics } = parse('');
    expect(diagnostics).toEqual([]);
    expect(form).toEqual({ askdown: '0.1', pages: [{ id: 'page-1', items: [] }] });
  });

  it('defaults a question without an answer to short text', () => {
    const [q] = questions(parse('? Name').form);
    expect(q).toEqual({ id: 'name', type: 'text', label: 'Name' });
  });

  it('handles CRLF line endings', () => {
    const { form, diagnostics } = parse('---\r\ntitle: Hi\r\n---\r\n? Name *\r\n___\r\n');
    expect(diagnostics).toEqual([]);
    expect(form.title).toBe('Hi');
    expect(questions(form)[0]).toMatchObject({ id: 'name', required: true });
  });

  it('uses a leading # heading as the form title when there is no front matter title', () => {
    const { form } = parse('# My form\n\nHello\n\n? Name');
    expect(form.title).toBe('My form');
    expect(form.pages[0]!.title).toBeUndefined();
    expect(form.pages[0]!.items[0]).toEqual({ type: 'content', markdown: 'Hello' });
  });

  it('uses a leading # heading as the page title when the front matter has a title', () => {
    const { form } = parse('---\ntitle: Form\n---\n# Page one\n? Name');
    expect(form.title).toBe('Form');
    expect(form.pages[0]!.title).toBe('Page one');
  });

  it('parses front matter scalars and block scalars', () => {
    const { form, diagnostics } = parse(
      [
        '---',
        'title: "Quoted: yes"',
        "submit: 'It''s done'",
        'description: |',
        '  Line one',
        '',
        '  Line three',
        '# a comment',
        'confirmation: Thanks # trailing comment',
        '---',
      ].join('\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(form).toMatchObject({
      title: 'Quoted: yes',
      description: 'Line one\n\nLine three',
      settings: { submitLabel: "It's done", confirmation: 'Thanks' },
    });
  });

  it('reports front matter problems', () => {
    expect(messages('---\ntitle: x')).toEqual([
      '1:error:Front matter is not closed. Add a line with --- after the settings.',
    ]);
    expect(messages('---\nfoo: bar\nlimitOne: true\ncollectEmail: true\n---')).toEqual([
      '2:warning:Unknown setting "foo".',
      '3:warning:"limitOne" is no longer supported. Limiting responses per respondent is up to the host.',
      '4:warning:"collectEmail" is no longer supported. Add an [email] question instead.',
    ]);
  });

  it('keeps question-like lines in fenced code as content', () => {
    const src = 'Example:\n\n```\n? Not a question\n---\n```\n\n? Real';
    const { form } = parse(src);
    expect(form.pages).toHaveLength(1);
    expect(form.pages[0]!.items[0]).toEqual({ type: 'content', markdown: 'Example:\n\n```\n? Not a question\n---\n```' });
    expect(questions(form)).toHaveLength(1);
  });

  it('unescapes \\? at the start of content lines', () => {
    const { form } = parse('\\? Not a question');
    expect(form.pages[0]!.items).toEqual([{ type: 'content', markdown: '? Not a question' }]);
  });

  it('assigns unique ids, avoiding explicit ones', () => {
    const ids = questions(parse('? Name\n\n? Name\n\n? Other {#name-2}').form).map((q) => q.id);
    expect(ids).toEqual(['name', 'name-3', 'name-2']);
  });

  it('slugifies non-ascii labels', () => {
    expect(questions(parse('? Één café?').form)[0]!.id).toBe('een-cafe');
    expect(questions(parse('? 🙂').form)[0]!.id).toBe('q');
  });

  it('parses page breaks with ids and jumps', () => {
    const { form, diagnostics } = parse('? A\n\n--- {#two} -> submit\n\n? B\n\n---\n\n? C');
    expect(diagnostics).toEqual([]);
    expect(form.pages.map((p) => [p.id, p.next])).toEqual([
      ['page-1', undefined],
      ['two', 'submit'],
      ['page-3', undefined],
    ]);
  });

  it('parses a standalone jump as the page jump', () => {
    const { form, diagnostics } = parse('? A\n\n-> #end\n\n---\n\n? B\n\n--- {#end}\n\n? C');
    expect(diagnostics).toEqual([]);
    expect(form.pages[0]!.next).toBe('end');
    expect(messages('? A\n\n-> submit\n-> submit')).toContain('4:error:This page already has a jump.');
    expect(messages('--- -> submit\n? A\n\n-> submit')).toContain('4:error:This page already has a jump.');
  });

  it('parses options with defaults, jumps and other', () => {
    const [q] = questions(parse('? Pick\n- (x) A -> #p2\n- ( ) B\n- ( ) Else: ___\n\n--- {#p2}').form);
    expect(q).toEqual({
      id: 'pick',
      type: 'radio',
      label: 'Pick',
      options: [{ label: 'A', default: true, goto: 'p2' }, { label: 'B' }],
      other: 'Else',
    });
  });

  it('treats a plain list as single choice', () => {
    expect(questions(parse('? Pick\n- A\n- B').form)[0]!.type).toBe('radio');
  });

  it('accepts indented answer lines', () => {
    const { form, diagnostics } = parse('? Pick\n  - [ ] A\n  - [ ] B');
    expect(diagnostics).toEqual([]);
    expect(questions(form)[0]!.type).toBe('checkbox');
  });

  it('parses scale and rating arguments', () => {
    const qs = questions(parse('? A\n[scale 0..10]\n\n? B\n[scale maxlabel=Top]\n\n? C\n[rating 3]\n\n? D\n[rating]').form);
    expect(qs.map(({ id, label, type, ...rest }) => rest)).toEqual([
      { min: 0, max: 10 },
      { min: 1, max: 5, maxLabel: 'Top' },
      { max: 3 },
      { max: 5 },
    ]);
  });

  it('parses quoted attribute values with escapes', () => {
    const [q] = questions(parse('? A\n[text placeholder="Say \\"hi\\""]').form);
    expect(q).toMatchObject({ placeholder: 'Say "hi"' });
  });

  it('uppercases an address country', () => {
    const [q] = questions(parse('? A\n[address country=nl]').form);
    expect(q).toEqual({ id: 'a', type: 'address', label: 'A', country: 'NL' });
  });

  it('parses phone attributes', () => {
    const [q] = questions(parse('? A\n[phone country=nl placeholder="06 1234"]').form);
    expect(q).toEqual({ id: 'a', type: 'phone', label: 'A', country: 'NL', placeholder: '06 1234' });
  });

  it('infers a ranking from numbered options', () => {
    const [q] = questions(parse('? A\n1. X\n2) Y\n  1. Z').form);
    expect(q).toEqual({ id: 'a', type: 'ranking', label: 'A', options: [{ label: 'X' }, { label: 'Y' }, { label: 'Z' }] });
  });

  it('parses an explicit ranking with plain options', () => {
    const [q] = questions(parse('? A\n[ranking shuffle]\n- X\n- Y').form);
    expect(q).toEqual({ id: 'a', type: 'ranking', label: 'A', options: [{ label: 'X' }, { label: 'Y' }], shuffle: true });
  });

  it('parses file sizes', () => {
    const [q] = questions(parse('? A\n[file maxsize=1.5MB]').form);
    expect(q).toMatchObject({ maxSize: 1572864 });
  });

  it.each([
    ['? A\n[bogus]', '2:error:Unknown question type "bogus".'],
    ['? A\n- ( ) X\n- [ ] Y', '1:error:Mix of ( ) and [ ] options. Use ( ) for single choice or [ ] for multiple choice.'],
    ['? A\n1. X\n- [ ] Y', '1:error:Mix of numbered and ( ) or [ ] options. Use numbered options only for a ranking.'],
    ['? A\n1. X', '1:error:A ranking needs at least two options.'],
    ['? A\n1. X\n2. Other: ___', '3:error:A ranking cannot have an "other" option.'],
    ['? A\n1. X\n2. Y -> submit', '3:warning:Jumps only work on single-choice questions.'],
    ['? A\n[ranking]\n- (x) X\n- Y', '3:warning:Use numbered options (1. 2. 3.) or - for a ranking.'],
    ['? A\n1. X\n1. X\n2. Y', '3:error:Duplicate option "X".'],
    ['? A\n[radio]\n1. X\n2. Y', '3:warning:Numbered options are for rankings. Use ( ) for options of a radio question.'],
    ['? A\n- ( ) X -> #nope', '2:error:There is no page with id "nope".'],
    ['? A {#x}\n\n? B {#x}', '3:error:Duplicate question id "x".'],
    ['? A {#-x}', '1:error:Invalid id "-x". Ids contain letters, digits, - and _, and start with a letter or digit.'],
    ['? A\n[select]', '2:error:A select question needs at least one option.'],
    ['? A\n[email]\n- X', '3:error:Options are not allowed on a email question.'],
    ['? A\n[text]\n| a | b |', '3:error:A table is only allowed on a grid question.'],
    ['? A\n[grid]', '2:error:A grid needs a table. The header row lists the columns, the first cell of each row is the row label.'],
    ['? A\n[scale 5..1]', '2:error:The scale minimum must be less than the maximum.'],
    ['? A\n[rating 20]', '2:error:The rating maximum must be between 2 and 10.'],
    ['? A\n[number min=abc]', '2:error:"min" must be a number.'],
    ['? A\n[date min=tomorrow]', '2:error:"min" must be formatted as YYYY-MM-DD.'],
    ['? A\n[text pattern="("]', '2:error:Invalid pattern "(".'],
    ['? A\n[file maxsize=lots]', '2:error:Invalid size "lots". Use for example 10MB.'],
    ['? A\n[address country=XY]', '2:error:Unknown country "XY". Use a two-letter code, such as NL or US.'],
    ['? A\n[text]\n[email]', '3:error:A question can only have one [type].'],
    ['? A\nsome text', '2:error:Unexpected line in question. Separate questions and text with a blank line.'],
    ['? A\n- ( ) X\n- ( ) X', '3:error:Duplicate option "X".'],
    ['? A\n[select]\n- X\n- Other: ___', '4:error:A select question cannot have an "other" option.'],
    ['? *', '1:error:Question has no label.'],
    ['? A\n[text foo=1]', '2:warning:Unknown attribute "foo" for text.'],
    ['? A\n\n___', '3:warning:This line looks like part of the question above, but a blank line separates them. Remove the blank line to attach it.'],
    ['? A\n- [ ] X -> #p\n\n--- {#p}', '2:warning:Jumps only work on single-choice questions.'],
    ['? A\n- (x) X\n- (x) Y', '1:warning:Only one option can be selected by default.'],
    ['--- {#a}\n\n? A\n\n--- {#b} -> #a\n\n? B', '5:warning:Jumping back to page "a" can create a loop.'],
    ['? A\n\n---\n\n---\n\n? B', '3:warning:This page is empty.'],
  ])('reports %j', (source, expected) => {
    expect(messages(source)).toContain(expected);
  });

  it('never throws on garbage input', () => {
    const inputs = ['---', '? ', '[', '- ( )', '|', '? A\n|', '? A\n[scale "unclosed]', '--- -> ', '? A {#}', '\u0000'];
    for (const input of inputs) {
      expect(() => parse(input)).not.toThrow();
    }
  });

  it('reports where questions and pages are defined', () => {
    const { locations } = parse('---\ntitle: x\n---\n\n? A {#a}\n\n--- {#p2}\n\n? B');
    expect(locations.questions).toEqual({
      a: { line: 5, explicitId: true },
      b: { line: 9, explicitId: false },
    });
    expect(locations.pages).toEqual({
      'page-1': { line: 4, explicitId: false },
      p2: { line: 7, explicitId: true },
    });
  });

  describe('choice value and flags', () => {
    it('parses {value .flag} on options', () => {
      const [q] = questions(parse('? Pick\n- ( ) Available {yes}\n- ( ) Maybe {maybe .muted}\n- ( ) No way {no}').form);
      expect(q).toMatchObject({
        type: 'radio',
        options: [
          { label: 'Available', value: 'yes' },
          { label: 'Maybe', value: 'maybe', flags: ['muted'] },
          { label: 'No way', value: 'no' },
        ],
      });
    });

    it('parses {value .flag} on grid rows and columns', () => {
      const [q] = questions(
        parse('? Feelings\n[grid]\n| | Love it {yes} | Meh {maybe} | Nope {no} | N/A {na .muted} |\n| Dark mode {dark} |\n| API |').form,
      ) as [import('../src/index.ts').GridQuestion];
      expect(q.columns).toEqual([
        { label: 'Love it', value: 'yes' },
        { label: 'Meh', value: 'maybe' },
        { label: 'Nope', value: 'no' },
        { label: 'N/A', value: 'na', flags: ['muted'] },
      ]);
      expect(q.rows).toEqual([{ label: 'Dark mode', value: 'dark' }, { label: 'API' }]);
    });

    it('omits value/flags when a choice has none', () => {
      const [q] = questions(parse('? Pick\n- ( ) Yes\n- ( ) No').form);
      expect(q).toMatchObject({ options: [{ label: 'Yes' }, { label: 'No' }] });
      expect((q as { options: object[] }).options[0]).not.toHaveProperty('value');
    });

    it('detects duplicate options by value, not label', () => {
      expect(messages('? A\n- ( ) Da {yes}\n- ( ) Ja {yes}')).toContain('3:error:Duplicate option "yes".');
      // Same labels but distinct explicit values are fine.
      expect(messages('? A\n- ( ) Pick {a}\n- ( ) Pick {b}')).toEqual([]);
    });

    it('warns on an id in a choice attribute block', () => {
      expect(messages('? A\n- ( ) X {#nope}')).toContain('2:warning:Ids are not allowed on options or grid cells.');
    });
  });
});

describe('serialize', () => {
  const roundTrip = (form: Form) => expect(parse(serialize(form)).form).toEqual(form);

  it('escapes content that looks like Askdown syntax', () => {
    roundTrip({
      askdown: '0.1',
      title: 'T',
      pages: [
        {
          id: 'page-1',
          items: [
            { type: 'content', markdown: '# Heading\n? Not a question\n-> #nope\n\n```\n? code\n---\n```' },
            { id: 'a', type: 'text', label: 'A' },
          ],
        },
      ],
    });
  });

  it('round-trips phone questions', () => {
    roundTrip({
      askdown: '0.1',
      title: 'T',
      pages: [
        {
          id: 'page-1',
          items: [
            { id: 'a', type: 'phone', label: 'A' },
            { id: 'b', type: 'phone', label: 'B', country: 'NL', placeholder: '06 1234 5678' },
          ],
        },
      ],
    });
  });

  it('round-trips choice value and flags', () => {
    const form: Form = {
      askdown: '0.1',
      pages: [
        {
          id: 'page-1',
          items: [
            {
              id: 'r',
              type: 'radio',
              label: 'r',
              options: [
                { label: 'Available', value: 'yes' },
                { label: 'Maybe', value: 'maybe', flags: ['muted'] },
              ],
            },
            {
              id: 'g',
              type: 'grid',
              label: 'g',
              rows: [{ label: 'Dark mode', value: 'dark' }, { label: 'API' }],
              columns: [
                { label: 'Love it', value: 'yes' },
                { label: 'N/A', value: 'na', flags: ['muted'] },
              ],
            },
          ],
        },
      ],
    };
    roundTrip(form);
    const text = serialize(form);
    expect(text).toContain('- ( ) Available {yes}');
    expect(text).toContain('- ( ) Maybe {maybe .muted}');
    expect(text).toContain('| Love it {yes} | N/A {na .muted} |');
    expect(text).toContain('| Dark mode {dark} |');
  });

  it('quotes YAML values that need it', () => {
    const form: Form = {
      askdown: '0.1',
      title: 'true',
      description: '# not a comment',
      settings: { submitLabel: 'Go: now', confirmation: 'Multi\n\nline' },
      pages: [{ id: 'page-1', items: [] }],
    };
    roundTrip(form);
    expect(serialize(form)).toBe(
      '---\ntitle: "true"\ndescription: "# not a comment"\nsubmit: "Go: now"\nconfirmation: |\n  Multi\n\n  line\n---\n',
    );
  });

  it('writes ids only when they differ from the derived id', () => {
    const form: Form = {
      askdown: '0.1',
      pages: [
        {
          id: 'page-1',
          items: [
            { id: 'name', type: 'text', label: 'Name' },
            { id: 'custom', type: 'text', label: 'Name' },
          ],
        },
      ],
    };
    expect(serialize(form)).toBe('? Name\n___\n\n? Name {#custom}\n___\n');
    roundTrip(form);
  });

  it('serializes every question type', () => {
    roundTrip({
      askdown: '0.1',
      pages: [
        {
          id: 'page-1',
          items: [
            { id: 'a', type: 'scale', label: 'a', min: 0, max: 3, maxLabel: 'hi' },
            { id: 'b', type: 'select', label: 'b', options: [{ label: 'x', default: true }, { label: 'y (z)' }] },
            { id: 'c', type: 'text', label: 'c', placeholder: '', pattern: '\\d+ "x"' },
            { id: 'd', type: 'grid', label: 'd', rows: [{ label: 'r' }], columns: [{ label: 'c1' }, { label: 'c2' }] },
            { id: 'e', type: 'file', label: 'e', maxSize: 1000 },
            { id: 'f', type: 'paragraph', label: 'f', help: 'line 1\n\nline 3' },
          ],
        },
      ],
    });
  });
});
