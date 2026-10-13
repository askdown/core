/**
 * International calling codes (ITU-T E.164) per ISO 3166-1 alpha-2 country,
 * without the leading "+". Countries that share a code (+1, +7, +44, …) each
 * list it; `countryForPhone` picks the main one.
 */
export const PHONE_CODES: Readonly<Record<string, string>> = {
  AD: '376', AE: '971', AF: '93', AG: '1', AI: '1', AL: '355', AM: '374', AO: '244', AR: '54', AS: '1',
  AT: '43', AU: '61', AW: '297', AX: '358', AZ: '994', BA: '387', BB: '1', BD: '880', BE: '32', BF: '226',
  BG: '359', BH: '973', BI: '257', BJ: '229', BL: '590', BM: '1', BN: '673', BO: '591', BQ: '599', BR: '55',
  BS: '1', BT: '975', BW: '267', BY: '375', BZ: '501', CA: '1', CC: '61', CD: '243', CF: '236', CG: '242',
  CH: '41', CI: '225', CK: '682', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238',
  CW: '599', CX: '61', CY: '357', CZ: '420', DE: '49', DJ: '253', DK: '45', DM: '1', DO: '1', DZ: '213',
  EC: '593', EE: '372', EG: '20', EH: '212', ER: '291', ES: '34', ET: '251', FI: '358', FJ: '679', FK: '500',
  FM: '691', FO: '298', FR: '33', GA: '241', GB: '44', GD: '1', GE: '995', GF: '594', GG: '44', GH: '233',
  GI: '350', GL: '299', GM: '220', GN: '224', GP: '590', GQ: '240', GR: '30', GT: '502', GU: '1', GW: '245',
  GY: '592', HK: '852', HN: '504', HR: '385', HT: '509', HU: '36', ID: '62', IE: '353', IL: '972', IM: '44',
  IN: '91', IO: '246', IQ: '964', IR: '98', IS: '354', IT: '39', JE: '44', JM: '1', JO: '962', JP: '81',
  KE: '254', KG: '996', KH: '855', KI: '686', KM: '269', KN: '1', KP: '850', KR: '82', KW: '965', KY: '1',
  KZ: '7', LA: '856', LB: '961', LC: '1', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370', LU: '352',
  LV: '371', LY: '218', MA: '212', MC: '377', MD: '373', ME: '382', MF: '590', MG: '261', MH: '692', MK: '389',
  ML: '223', MM: '95', MN: '976', MO: '853', MP: '1', MQ: '596', MR: '222', MS: '1', MT: '356', MU: '230',
  MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258', NA: '264', NC: '687', NE: '227', NF: '672', NG: '234',
  NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NU: '683', NZ: '64', OM: '968', PA: '507', PE: '51',
  PF: '689', PG: '675', PH: '63', PK: '92', PL: '48', PM: '508', PR: '1', PS: '970', PT: '351', PW: '680',
  PY: '595', QA: '974', RE: '262', RO: '40', RS: '381', RU: '7', RW: '250', SA: '966', SB: '677', SC: '248',
  SD: '249', SE: '46', SG: '65', SH: '290', SI: '386', SJ: '47', SK: '421', SL: '232', SM: '378', SN: '221',
  SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SX: '1', SY: '963', SZ: '268', TC: '1', TD: '235',
  TG: '228', TH: '66', TJ: '992', TK: '690', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90', TT: '1',
  TV: '688', TW: '886', TZ: '255', UA: '380', UG: '256', US: '1', UY: '598', UZ: '998', VA: '39', VC: '1',
  VE: '58', VG: '1', VI: '1', VN: '84', VU: '678', WF: '681', WS: '685', XK: '383', YE: '967', YT: '262',
  ZA: '27', ZM: '260', ZW: '263',
};

/** The main country for a code shared by several countries. */
const MAIN_COUNTRY: Readonly<Record<string, string>> = {
  '1': 'US', '7': 'RU', '44': 'GB', '47': 'NO', '61': 'AU', '212': 'MA', '262': 'RE', '358': 'FI',
  '39': 'IT', '590': 'GP', '599': 'CW',
};

/** Countries whose national numbers keep their leading 0 after the country code. */
const KEEPS_TRUNK_ZERO = new Set(['IT', 'SM', 'VA']);

/** E.164: "+", a country code, and at most 15 digits in total. */
export const E164 = /^\+[1-9]\d{6,14}$/;

/** The calling code for a country, without "+", or undefined for an unknown country. */
export function phoneCode(country: string): string | undefined {
  return PHONE_CODES[country.toUpperCase()];
}

/** The flag emoji for a country code, e.g. "NL" → 🇳🇱. */
export function flagEmoji(country: string): string {
  return [...country.toUpperCase()].map((c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0))).join('');
}

/**
 * Turns what a respondent typed into an E.164 number, or undefined if it
 * can't be one. Numbers starting with "+" or "00" are international and
 * ignore `country`; others are national numbers in `country`, with a leading
 * trunk 0 dropped ("06 1234 5678" in NL → "+31612345678").
 */
export function toE164(input: string, country?: string): string | undefined {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[\s().\-\/]/g, '');
  if (!/^\+?\d+$/.test(digits)) return undefined;
  let result: string;
  if (digits.startsWith('+')) {
    result = digits;
  } else if (digits.startsWith('00')) {
    result = '+' + digits.slice(2);
  } else {
    const code = country ? phoneCode(country) : undefined;
    if (code === undefined) return undefined;
    if (digits.startsWith('0') && !KEEPS_TRUNK_ZERO.has(country!.toUpperCase())) digits = digits.slice(1);
    result = '+' + code + digits;
  }
  return E164.test(result) && countryForPhone(result) !== undefined ? result : undefined;
}

/** The country an E.164 number belongs to, by its calling code; the main country for shared codes. */
export function countryForPhone(e164: string): string | undefined {
  const digits = e164.replace(/^\+/, '');
  for (let len = 3; len >= 1; len--) {
    const code = digits.slice(0, len);
    if (MAIN_COUNTRY[code]) return MAIN_COUNTRY[code];
    for (const [country, c] of Object.entries(PHONE_CODES)) if (c === code) return country;
  }
  return undefined;
}

/** An E.164 number split for display: "+31612345678" → "+31 612345678". */
export function formatPhone(e164: string): string {
  const country = countryForPhone(e164);
  const code = country ? PHONE_CODES[country]! : '';
  return code ? `+${code} ${e164.slice(1 + code.length)}` : e164;
}
