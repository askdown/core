import { describe, expect, it } from 'vitest';
import { countryForPhone, flagEmoji, phoneCode, toE164 } from '../src/index.ts';

describe('toE164', () => {
  it.each([
    ['06 1234 5678', 'NL', '+31612345678'],
    ['(415) 555-2671', 'US', '+14155552671'],
    ['+44 20 7946 0958', 'NL', '+442079460958'],
    ['0031 6 1234 5678', 'US', '+31612345678'],
    ['+31612345678', undefined, '+31612345678'],
    ['06 12 34 56 78', 'it', '+390612345678'],
    ['0612345678', undefined, undefined],
    ['0612345678', 'XY', undefined],
    ['hello', 'NL', undefined],
    ['+31', 'NL', undefined],
    ['', 'NL', undefined],
  ])('%s (%s) -> %s', (input, country, expected) => {
    expect(toE164(input, country)).toBe(expected);
  });
});

describe('helpers', () => {
  it('looks up codes, flags and countries', () => {
    expect(phoneCode('nl')).toBe('31');
    expect(phoneCode('XY')).toBeUndefined();
    expect(flagEmoji('NL')).toBe('🇳🇱');
    expect(countryForPhone('+14155552671')).toBe('US');
    expect(countryForPhone('+31612345678')).toBe('NL');
    expect(countryForPhone('+442079460958')).toBe('GB');
  });
});
