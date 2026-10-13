import { describe, expect, it } from 'vitest';
import {
  ADDRESS_FORMAT_COUNTRIES,
  addressFormat,
  checkAnswer,
  formatAddressLine,
  isCountryCode,
  parse,
  type Question,
} from '../src/index.ts';

describe('addressFormat', () => {
  it('has a province list for Canada', () => {
    const format = addressFormat('ca');
    expect(format.parts).toEqual(['street', 'city', 'region', 'postalCode']);
    expect(format.regions).toHaveLength(13);
    expect(format.labels.region).toBe('Province');
  });

  it('leaves the region out for the Netherlands', () => {
    expect(addressFormat('NL').parts).toEqual(['street', 'postalCode', 'city']);
  });

  it('falls back to the default format', () => {
    expect(addressFormat('AO')).toBe(addressFormat());
    expect(addressFormat().required).toEqual(['street', 'city']);
  });

  it.each(ADDRESS_FORMAT_COUNTRIES)('%s is consistent', (country) => {
    const format = addressFormat(country);
    expect(isCountryCode(country)).toBe(true);
    expect(format.parts).toContain('street');
    expect(format.parts).toContain('city');
    expect(format.required).toEqual(expect.arrayContaining(['street', 'city']));
    for (const part of format.required) expect(format.parts).toContain(part);
    if (format.regions) {
      expect(format.parts).toContain('region');
      const codes = format.regions.map(([code]) => code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const [code, name] of format.regions) {
        expect(code).toMatch(/^[A-Z0-9]{1,3}$/);
        expect(name.trim()).toBe(name);
        expect(name).not.toBe('');
      }
    }
  });
});

describe('formatAddressLine', () => {
  it.each([
    [{ street: 'Keizersgracht 1', city: 'Amsterdam', postalCode: '1015 AA', country: 'NL' }, 'Keizersgracht 1, 1015 AA Amsterdam, NL'],
    [{ street: '1 King St W\nSuite 2', city: 'Toronto', region: 'ON', postalCode: 'M5V 2T6', country: 'CA' }, '1 King St W, Suite 2, Toronto ON M5V 2T6, CA'],
    [{ street: '1-1 Chiyoda', city: 'Chiyoda-ku', region: '13', postalCode: '100-0001', country: 'JP' }, '1-1 Chiyoda, 100-0001 Tokyo Chiyoda-ku, JP'],
    [{ street: 'Rua 1', city: 'Luanda', country: 'AO' }, 'Rua 1, Luanda, AO'],
  ])('%j', (address, expected) => {
    expect(formatAddressLine(address)).toBe(expected);
  });
});

describe('postal codes', () => {
  const answer = (country: string, postalCode: string) => {
    const q = parse(`? A\n[address country=${country}]`).form.pages[0]!.items[0] as Question;
    const region = addressFormat(country).regions?.[0]?.[0];
    return checkAnswer(q, { street: 'x', city: 'y', postalCode, ...(region && { region }) });
  };

  it.each([
    ['CA', 'm5v2t6', 'M5V 2T6'],
    ['CA', ' m5v  2T6 ', 'M5V 2T6'],
    ['CA', 'M5V-2T6', 'M5V 2T6'],
    ['US', '62701', '62701'],
    ['US', '627011234', '62701-1234'],
    ['US', '62701 - 1234', '62701-1234'],
    ['NL', '1015aa', '1015 AA'],
    ['JP', '1000001', '100-0001'],
    ['JP', '100-0001', '100-0001'],
    ['DE', '10115', '10115'],
    ['GB', 'sw1a1aa', 'SW1A 1AA'],
    ['GB', 'm1  1ae', 'M1 1AE'],
    // Postcodes in the UK aren't checked, only normalized when they can be.
    ['GB', 'BFPO 123', 'BFPO 123'],
  ])('%s %j becomes %j', (country, input, expected) => {
    expect(answer(country, input)).toMatchObject({ value: { postalCode: expected } });
  });

  it.each([
    ['CA', '12345', 'Enter a postal code like A1A 1A1.'],
    // D, F, I, O, Q and U are never used; W and Z never come first.
    ['CA', 'D5V 2T6', 'Enter a postal code like A1A 1A1.'],
    ['CA', 'W5V 2T6', 'Enter a postal code like A1A 1A1.'],
    ['CA', 'M5V 2T', 'Enter a postal code like A1A 1A1.'],
    ['US', '6270', 'Enter a ZIP code like 12345.'],
    ['US', 'ABCDE', 'Enter a ZIP code like 12345.'],
    ['NL', '0123 AB', 'Enter a postcode like 1234 AB.'],
    ['NL', '1234', 'Enter a postcode like 1234 AB.'],
    ['JP', '100-001', 'Enter a postal code like 123-4567.'],
    ['DE', '1011', 'Enter a postal code like 12345.'],
  ])('%s rejects %j', (country, input, error) => {
    expect(answer(country, input)).toEqual({ error });
  });

  it('leaves other countries alone', () => {
    const q = parse('? A\n[address country=FR]').form.pages[0]!.items[0] as Question;
    expect(checkAnswer(q, { street: 'x', city: 'y', postalCode: 'abc' })).toMatchObject({ value: { postalCode: 'abc' } });
  });
});
