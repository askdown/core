import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkAnswer,
  type Form,
  nextPage,
  parse,
  type Question,
  validateForm,
  validateResponse,
  visitedPages,
} from '../src/index.ts';

const q = (source: string) => parse(source).form.pages[0]!.items[0] as Question;
const branching = parse(readFileSync(new URL('../vendor/spec/examples/branching.ask', import.meta.url), 'utf8')).form;

describe('checkAnswer', () => {
  it.each<[string, unknown, ReturnType<typeof checkAnswer>]>([
    ['? A *', undefined, { error: 'This question is required.' }],
    ['? A *', '  ', { error: 'This question is required.' }],
    ['? A', '', {}],
    ['? A', ' hi ', { value: 'hi' }],
    ['? A', 5, { error: 'Expected text.' }],
    ['? A\n[text maxlength=3]', 'abcd', { error: 'Enter at most 3 characters.' }],
    ['? A\n[text maxlength=3]', '🙂🙂🙂', { value: '🙂🙂🙂' }],
    ['? A\n[text pattern="\\d+"]', '12a', { error: 'The answer is not in the expected format.' }],
    ['? A\n[text pattern="\\d+|x"]', 'x', { value: 'x' }],
    ['? A\n[paragraph minlength=5]', 'abc', { error: 'Enter at least 5 characters.' }],
    ['? A', 'x'.repeat(1001), { error: 'Enter at most 1000 characters.' }],
    ['? A\n[text maxlength=2000]', 'x'.repeat(1500), { value: 'x'.repeat(1500) }],
    ['? A\n[email]', 'x'.repeat(1001), { error: 'Enter at most 1000 characters.' }],
    ['? A\n- ( ) X\n- ( ) Other: ___', 'x'.repeat(1001), { error: 'Enter at most 1000 characters.' }],
    ['? A\n[paragraph]', 'line 1\n  line 2  ', { value: 'line 1\n  line 2' }],
    ['? A\n[email]', 'nope', { error: 'Enter a valid email address.' }],
    ['? A\n[email]', 'a@b.co', { value: 'a@b.co' }],
    ['? A\n[phone]', '+31 6 12345678', { value: '+31612345678' }],
    ['? A\n[phone]', '0612345678', { error: 'Enter a valid phone number, including the country code.' }],
    ['? A\n[phone]', '+31612345678', { value: '+31612345678' }],
    ['? A\n[phone]', '0031 6 1234 5678', { value: '+31612345678' }],
    ['? A\n[phone]', 'nope', { error: 'Enter a valid phone number, including the country code.' }],
    ['? A\n[phone]', '  ', {}],
    ['? A *\n[phone]', '', { error: 'This question is required.' }],
    ['? A\n[phone]', 5, { error: 'Expected text.' }],
    ['? A\n[url]', 'javascript:alert(1)', { error: 'Enter a valid URL, starting with https://.' }],
    ['? A\n[url]', 'https://x.dev', { value: 'https://x.dev' }],
    ['? A\n[number min=1 max=10 step=0.5]', '2.5', { value: 2.5 }],
    ['? A\n[number min=1 max=10 step=0.5]', '2.2', { error: 'Enter a multiple of 0.5.' }],
    ['? A\n[number min=1]', 0, { error: 'Enter a number of at least 1.' }],
    ['? A\n[number]', 'abc', { error: 'Enter a number.' }],
    ['? A\n[date min=2020-01-01]', '2019-12-31', { error: 'Enter a date on or after 2020-01-01.' }],
    ['? A\n[date]', '2020-13-45', { error: 'Enter a valid date.' }],
    ['? A\n[time max=12:00]', '13:00', { error: 'Enter a time at or before 12:00.' }],
    ['? A\n- ( ) X\n- ( ) Y', 'Z', { error: 'Choose one of the options.' }],
    ['? A\n- ( ) X\n- ( ) Other: ___', 'Z', { value: 'Z' }],
    ['? A\n[select]\n- X', 'X', { value: 'X' }],
    ['? A\n- [ ] X\n- [ ] Y', 'Y', { value: ['Y'] }],
    ['? A\n- [ ] X\n- [ ] Y', ['Y', 'X', 'Y'], { value: ['X', 'Y'] }],
    ['? A\n- [ ] X\n- [ ] Y', ['Z'], { error: 'Choose from the options.' }],
    ['? A\n- [ ] X\n- [ ] Other: ___', ['mine', 'X'], { value: ['X', 'mine'] }],
    ['? A\n[checkbox max=1]\n- [ ] X\n- [ ] Y', ['X', 'Y'], { error: 'Choose at most 1.' }],
    ['? A\n[scale 1..5]', '3', { value: 3 }],
    ['? A\n[scale 1..5]', '6', { error: 'Enter a number of at most 5.' }],
    ['? A\n[rating 5]', 0, { error: 'Enter a number of at least 1.' }],
    ['? A\n[grid]\n| | a | b |\n| r1 |\n| r2 |', { r2: 'b', r1: 'a' }, { value: { r1: 'a', r2: 'b' } }],
    ['? A *\n[grid]\n| | a | b |\n| r1 |\n| r2 |', { r1: 'a' }, { error: 'Answer "r2".' }],
    ['? A\n[grid]\n| | a | b |\n| r1 |', { r1: ['a', 'b'] }, { error: 'Choose one column for "r1".' }],
    ['? A\n[checkbox-grid]\n| | a | b |\n| r1 |', { r1: ['b', 'a'] }, { value: { r1: ['a', 'b'] } }],
    ['? A\n[grid]\n| | a |\n| r1 |', { r9: 'a' }, { error: 'Unknown row "r9".' }],
    ['? A\n[file maxsize=1KB]', [{ name: 'a.txt', size: 2000, type: 'text/plain' }], { error: '"a.txt" is larger than 1KB.' }],
    ['? A\n[file accept=image/*]', { name: 'a.txt', size: 1, type: 'text/plain' }, { error: '"a.txt" is not an accepted file type.' }],
    ['? A\n[file accept=.PNG]', { name: 'a.png', size: 1, type: '' }, { value: [{ name: 'a.png', size: 1, type: '' }] }],
    [
      '? A\n[file]',
      [{ name: 'a.txt', size: 2, type: 'text/plain', uri: 'data:text/plain,hi', extra: 1 }],
      { value: [{ name: 'a.txt', size: 2, type: 'text/plain', uri: 'data:text/plain,hi' }] },
    ],
    ['? A\n[file]', [{ name: 'a', size: 1, type: '' }, { name: 'b', size: 1, type: '' }], { error: 'Upload at most 1 file.' }],
    ['? A *\n[file]', [{ name: '', size: 0, type: 'application/octet-stream' }], { error: 'This question is required.' }],
    ['? A *\n1. X\n2. Y', [], { error: 'This question is required.' }],
    ['? A\n1. X\n2. Y', [' Y ', 'X'], { value: ['Y', 'X'] }],
    ['? A\n1. X\n2. Y\n3. Z', ['Y', 'X'], { error: 'Rank all of the options.' }],
    ['? A\n1. X\n2. Y', ['Y', 'Y'], { error: 'Rank each option once.' }],
    ['? A\n1. X\n2. Y', ['Y', 'W'], { error: 'Rank each option once.' }],
    ['? A\n1. X\n2. Y', 'X', { error: 'Expected a list of options.' }],
    ['? A *\n[address]', { street: ' ', city: '', country: '' }, { error: 'This question is required.' }],
    ['? A *\n[address country=NL]', { street: '', country: 'NL' }, { error: 'This question is required.' }],
    ['? A\n[address]', { street: 'Main St 1', country: 'US' }, { error: 'Enter the city.' }],
    ['? A\n[address]', { city: 'Springfield', country: 'US' }, { error: 'Enter the street address.' }],
    ['? A\n[address]', { street: 'Main St 1', city: 'Springfield' }, { error: 'Choose a country.' }],
    ['? A\n[address]', { street: 'Main St 1', city: 'Springfield', country: 'XY' }, { error: 'Choose one of the countries.' }],
    ['? A\n[address]', { street: 'x', city: 'y', country: 'US', planet: 'Earth' }, { error: 'Unknown address part "planet".' }],
    ['? A\n[address]', { street: 'x'.repeat(1001), city: 'y', country: 'US' }, { error: 'Enter at most 1000 characters.' }],
    ['? A\n[address]', 'Main St 1', { error: 'Expected an address.' }],
    ['? A\n[address country=NL]', { street: 'x', city: 'y', country: 'BE' }, { error: 'Enter an address in the given country.' }],
    [
      '? A\n[address]',
      { street: ' Main St 1\nApt 2 ', city: 'Springfield', region: 'il', postalCode: '62701', country: 'us' },
      { value: { street: 'Main St 1\nApt 2', city: 'Springfield', region: 'IL', postalCode: '62701', country: 'US' } },
    ],
    ['? A\n[address]', { street: 'x', city: 'y', postalCode: '62701', country: 'US' }, { error: 'Choose a state.' }],
    ['? A\n[address]', { street: 'x', city: 'y', region: 'IL', country: 'US' }, { error: 'Enter the ZIP code.' }],
    ['? A\n[address country=CA]', { street: 'x', city: 'y', postalCode: 'M5V 2T6' }, { error: 'Choose a province.' }],
    [
      '? A\n[address country=CA]',
      { street: 'x', city: 'y', region: 'XX', postalCode: 'M5V 2T6' },
      { error: 'Choose a province from the list.' },
    ],
    [
      '? A\n[address country=CA]',
      { street: '1 King St W', city: 'Toronto', region: 'on', postalCode: 'M5V 2T6' },
      { value: { street: '1 King St W', city: 'Toronto', region: 'ON', postalCode: 'M5V 2T6', country: 'CA' } },
    ],
    [
      '? A\n[address country=NL]',
      { street: 'Keizersgracht 1', city: 'Amsterdam', region: 'Noord-Holland', postalCode: '1015 AA' },
      { value: { street: 'Keizersgracht 1', city: 'Amsterdam', postalCode: '1015 AA', country: 'NL' } },
    ],
    ['? A\n[address country=NL]', { street: 'x', city: 'y' }, { error: 'Enter the postcode.' }],
    [
      '? A\n[address]',
      { street: 'Rua 1', city: 'Luanda', country: 'AO' },
      { value: { street: 'Rua 1', city: 'Luanda', country: 'AO' } },
    ],
    [
      '? A\n[address country=NL]',
      { postalCode: '1015 AA', city: 'Amsterdam', street: 'Keizersgracht 1' },
      { value: { street: 'Keizersgracht 1', city: 'Amsterdam', postalCode: '1015 AA', country: 'NL' } },
    ],
    // Choices validate against their value, not their label.
    ['? A\n- ( ) Available {yes}\n- ( ) No way {no}', 'yes', { value: 'yes' }],
    ['? A\n- ( ) Available {yes}\n- ( ) No way {no}', 'Available', { error: 'Choose one of the options.' }],
    ['? A\n- ( ) A {a}\n- ( ) Else: ___', 'typed in', { value: 'typed in' }],
    ['? A\n[checkbox]\n- [ ] One {1}\n- [ ] Two {2}', ['2', '1'], { value: ['1', '2'] }],
    [
      '? A *\n[grid]\n| | Yes {y} | No {n} |\n| Row 1 {r1} |\n| Row 2 {r2} |',
      { r1: 'y', r2: 'n' },
      { value: { r1: 'y', r2: 'n' } },
    ],
    [
      '? A *\n[grid]\n| | Yes {y} | No {n} |\n| Row 1 {r1} |\n| Row 2 {r2} |',
      { r1: 'y' },
      { error: 'Answer "Row 2".' },
    ],
    ['? A\n[grid]\n| | Yes {y} | No {n} |\n| Row 1 {r1} |', { r1: 'No' }, { error: 'Choose one of the columns for "r1".' }],
  ])('%j with %j', (source, input, expected) => {
    expect(checkAnswer(q(source), input)).toEqual(expected);
  });
});

describe('navigation', () => {
  it('follows option jumps', () => {
    expect(nextPage(branching, 0, { 'what-do-you-need-help-with': 'A bug' })).toBe(2);
    expect(nextPage(branching, 0, { 'what-do-you-need-help-with': 'Nothing, never mind' })).toBeNull();
    expect(nextPage(branching, 0, {})).toBe(1);
  });

  it('follows page next', () => {
    expect(nextPage(branching, 1, {})).toBeNull();
    expect(visitedPages(branching, { 'what-do-you-need-help-with': 'Billing' })).toEqual([0, 1]);
    expect(visitedPages(branching, { 'what-do-you-need-help-with': 'A bug' })).toEqual([0, 2]);
  });

  it('stops at loops', () => {
    const form = parse('--- {#a}\n? A\n\n--- {#b} -> #a\n? B').form;
    expect(visitedPages(form, {})).toEqual([0, 1]);
  });
});

describe('validateResponse', () => {
  it('ignores and drops answers on skipped pages', () => {
    const result = validateResponse(branching, {
      'what-do-you-need-help-with': 'Billing',
      'invoice-number': 'INV-1',
      'what-happened': '',
      'unknown-question': 'x',
    });
    expect(result).toEqual({
      valid: true,
      errors: [],
      answers: { 'what-do-you-need-help-with': 'Billing', 'invoice-number': 'INV-1' },
      pages: [0, 1],
    });
  });

  it('reports required questions on visited pages', () => {
    const result = validateResponse(branching, { 'what-do-you-need-help-with': 'A bug' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([{ id: 'what-happened', message: 'This question is required.' }]);
  });
});

describe('validateForm', () => {
  it('reports structural problems', () => {
    const form: Form = {
      askdown: '0.1',
      pages: [
        {
          id: 'p',
          next: 'nowhere',
          items: [
            { id: 'a', type: 'radio', label: 'A', options: [{ label: 'x' }, { label: 'x', goto: 'gone' }] },
            { id: 'a', type: 'scale', label: ' ', min: 5, max: 1 },
            { id: 'bad id', type: 'grid', label: 'G', rows: [], columns: [{ label: 'c' }, { label: 'c' }] },
          ],
        },
      ],
    };
    expect(validateForm(form).map((p) => `${p.path} ${p.message}`)).toEqual([
      '/pages/0/next There is no page with id "nowhere".',
      '/pages/0/items/0/options/1/label Duplicate option "x".',
      '/pages/0/items/0/options/1/goto There is no page with id "gone".',
      '/pages/0/items/1/id Duplicate question id "a".',
      '/pages/0/items/1/label Question has no label.',
      '/pages/0/items/1/max The maximum must be greater than the minimum.',
      '/pages/0/items/2/id Invalid question id "bad id".',
      '/pages/0/items/2/rows Needs at least one row.',
      '/pages/0/items/2/columns Columns must be unique.',
    ]);
  });
});
