/**
 * Per-country address formats: which parts an address has, in which order,
 * what they're called, and which are required.
 *
 * Which countries are listed, and where the data comes from:
 *
 * - A country gets a region list when its national postal service requires
 *   the subdivision in a postal address. The list is exactly that country's
 *   ISO 3166-2 subdivisions of the level used in addresses. ISO 3166-2 is the
 *   only source: nothing is added or left out.
 * - A country hides the region when its postal service's addressing guide
 *   doesn't use one.
 * - Field order and labels follow the country's postal service guide, or the
 *   Universal Postal Union's addressing summary for that country.
 * - Every other country gets the default format, so a missing entry never
 *   blocks anyone.
 *
 * Adding a country means citing its postal guide next to the entry.
 *
 * Regions are stored as the ISO 3166-2 code without the country prefix
 * ("ON" for CA-ON, "13" for JP-13).
 */

export type AddressPart = 'street' | 'city' | 'region' | 'postalCode';

export interface AddressFormat {
  /** The parts after the country, in display order. Parts left out aren't used. */
  parts: AddressPart[];
  /** Parts that must be filled in. */
  required: AddressPart[];
  labels: { street: string; city: string; region: string; postalCode: string };
  /** Region codes and names, in display order. A list makes the region a choice. */
  regions?: readonly (readonly [code: string, name: string])[];
  /** How the region is written in a one-line address. */
  regionDisplay: 'code' | 'name';
  postalCodeRule?: PostalCodeRule;
}

/**
 * How a country writes its postal codes. Only for countries whose postal
 * codes have one well-defined form.
 */
export interface PostalCodeRule {
  /** An example in the stored form, for placeholders and error messages. */
  example: string;
  /** Regular expression for the stored form. Without one, the postal code is normalized but not checked. */
  pattern?: string;
  /** Whether it's digits only, apart from separators. */
  numeric?: boolean;
  /** Rewrites a trimmed postal code into the stored form, or returns undefined when it can't. */
  normalize(value: string): string | undefined;
}

/** Uppercases and removes spaces and hyphens. */
function compact(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '');
}

/** A rule that splits the compacted code at `at`, with `separator`, when it matches `compactPattern`. */
function splitRule(example: string, pattern: string, compactPattern: RegExp, at: number, separator: string, numeric = false): PostalCodeRule {
  return {
    example,
    pattern,
    numeric,
    normalize(value) {
      const code = compact(value);
      return compactPattern.test(code) ? code.slice(0, at) + separator + code.slice(at) : undefined;
    },
  };
}

const LABELS = { street: 'Street address', city: 'City', region: 'Region', postalCode: 'Postal code' };

/** Used for countries that aren't listed, and before a country is chosen. */
const DEFAULT_FORMAT: AddressFormat = {
  parts: ['street', 'postalCode', 'city', 'region'],
  required: ['street', 'city'],
  labels: LABELS,
  regionDisplay: 'name',
};

/** Street, postal code, city; no region. */
function postalCodeFirst(postalCode = 'Postal code', postalCodeRule?: PostalCodeRule): AddressFormat {
  return {
    parts: ['street', 'postalCode', 'city'],
    required: ['street', 'postalCode', 'city'],
    labels: { ...LABELS, postalCode },
    regionDisplay: 'name',
    ...(postalCodeRule && { postalCodeRule }),
  };
}

/** Street, city, region, postal code, all required. */
function withRegion(
  region: string,
  postalCode: string,
  regions: AddressFormat['regions'],
  regionDisplay: AddressFormat['regionDisplay'],
  city = 'City',
  postalCodeRule?: PostalCodeRule,
): AddressFormat {
  return {
    parts: ['street', 'city', 'region', 'postalCode'],
    required: ['street', 'city', 'region', 'postalCode'],
    labels: { ...LABELS, city, region, postalCode },
    regions,
    regionDisplay,
    ...(postalCodeRule && { postalCodeRule }),
  };
}

const FORMATS: Record<string, AddressFormat> = {
  // USPS Publication 28
  US: withRegion('State', 'ZIP code', regionList(`
    AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|
    DC District of Columbia|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|
    KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|
    MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|
    NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|
    PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|
    VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming|AS American Samoa|
    GU Guam|MP Northern Mariana Islands|PR Puerto Rico|UM United States Minor Outlying Islands|
    VI U.S. Virgin Islands`), 'code', 'City', {
    example: '12345',
    pattern: '^\\d{5}(-\\d{4})?$',
    numeric: true,
    normalize(value) {
      const code = compact(value);
      if (/^\d{5}$/.test(code)) return code;
      return /^\d{9}$/.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}` : undefined;
    },
  }),
  // Canada Post Addressing Guidelines
  CA: withRegion('Province', 'Postal code', regionList(`
    AB Alberta|BC British Columbia|MB Manitoba|NB New Brunswick|NL Newfoundland and Labrador|
    NS Nova Scotia|NT Northwest Territories|NU Nunavut|ON Ontario|PE Prince Edward Island|QC Quebec|
    SK Saskatchewan|YT Yukon`), 'code', 'City', splitRule(
    'A1A 1A1',
    '^[ABCEGHJ-NPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z] \\d[ABCEGHJ-NPRSTV-Z]\\d$',
    /^[A-Z]\d[A-Z]\d[A-Z]\d$/,
    3,
    ' ',
  )),
  // Australia Post Addressing Guidelines
  AU: withRegion('State', 'Postcode', regionList(`
    ACT Australian Capital Territory|NSW New South Wales|NT Northern Territory|QLD Queensland|
    SA South Australia|TAS Tasmania|VIC Victoria|WA Western Australia`), 'code', 'Suburb'),
  // Correios addressing guide
  BR: withRegion('State', 'CEP', regionList(`
    AC Acre|AL Alagoas|AP Amapá|AM Amazonas|BA Bahia|CE Ceará|DF Distrito Federal|ES Espírito Santo|
    GO Goiás|MA Maranhão|MT Mato Grosso|MS Mato Grosso do Sul|MG Minas Gerais|PA Pará|PB Paraíba|
    PR Paraná|PE Pernambuco|PI Piauí|RJ Rio de Janeiro|RN Rio Grande do Norte|RS Rio Grande do Sul|
    RO Rondônia|RR Roraima|SC Santa Catarina|SP São Paulo|SE Sergipe|TO Tocantins`), 'code'),
  // Correos de México; UPU addressing summary
  MX: {
    parts: ['street', 'postalCode', 'city', 'region'],
    required: ['street', 'postalCode', 'city', 'region'],
    labels: { ...LABELS, region: 'State' },
    regions: regionList(`
      AGU Aguascalientes|BCN Baja California|BCS Baja California Sur|CAM Campeche|CHP Chiapas|
      CHH Chihuahua|CMX Ciudad de México|COA Coahuila|COL Colima|DUR Durango|GUA Guanajuato|
      GRO Guerrero|HID Hidalgo|JAL Jalisco|MEX Estado de México|MIC Michoacán|MOR Morelos|NAY Nayarit|
      NLE Nuevo León|OAX Oaxaca|PUE Puebla|QUE Querétaro|ROO Quintana Roo|SLP San Luis Potosí|
      SIN Sinaloa|SON Sonora|TAB Tabasco|TAM Tamaulipas|TLA Tlaxcala|VER Veracruz|YUC Yucatán|
      ZAC Zacatecas`),
    regionDisplay: 'name',
  },
  // India Post; UPU addressing summary
  IN: withRegion('State', 'PIN code', regionList(`
    AN Andaman and Nicobar Islands|AP Andhra Pradesh|AR Arunachal Pradesh|AS Assam|BR Bihar|
    CH Chandigarh|CG Chhattisgarh|DH Dadra and Nagar Haveli and Daman and Diu|DL Delhi|GA Goa|
    GJ Gujarat|HR Haryana|HP Himachal Pradesh|JK Jammu and Kashmir|JH Jharkhand|KA Karnataka|
    KL Kerala|LA Ladakh|LD Lakshadweep|MP Madhya Pradesh|MH Maharashtra|MN Manipur|ML Meghalaya|
    MZ Mizoram|NL Nagaland|OD Odisha|PY Puducherry|PB Punjab|RJ Rajasthan|SK Sikkim|TN Tamil Nadu|
    TS Telangana|TR Tripura|UP Uttar Pradesh|UK Uttarakhand|WB West Bengal`), 'name'),
  // Japan Post; UPU addressing summary. Written from the largest unit down.
  JP: {
    parts: ['postalCode', 'region', 'city', 'street'],
    required: ['postalCode', 'region', 'city', 'street'],
    labels: { ...LABELS, region: 'Prefecture' },
    postalCodeRule: splitRule('123-4567', '^\\d{3}-\\d{4}$', /^\d{7}$/, 3, '-', true),
    regions: regionList(`
      01 Hokkaido|02 Aomori|03 Iwate|04 Miyagi|05 Akita|06 Yamagata|07 Fukushima|08 Ibaraki|09 Tochigi|
      10 Gunma|11 Saitama|12 Chiba|13 Tokyo|14 Kanagawa|15 Niigata|16 Toyama|17 Ishikawa|18 Fukui|
      19 Yamanashi|20 Nagano|21 Gifu|22 Shizuoka|23 Aichi|24 Mie|25 Shiga|26 Kyoto|27 Osaka|28 Hyogo|
      29 Nara|30 Wakayama|31 Tottori|32 Shimane|33 Okayama|34 Hiroshima|35 Yamaguchi|36 Tokushima|
      37 Kagawa|38 Ehime|39 Kochi|40 Fukuoka|41 Saga|42 Nagasaki|43 Kumamoto|44 Oita|45 Miyazaki|
      46 Kagoshima|47 Okinawa`),
    regionDisplay: 'name',
  },
  // Poste Italiane addressing guide
  IT: {
    parts: ['street', 'postalCode', 'city', 'region'],
    required: ['street', 'postalCode', 'city', 'region'],
    labels: { ...LABELS, region: 'Province', postalCode: 'CAP' },
    regions: regionList(`
      AG Agrigento|AL Alessandria|AN Ancona|AO Aosta|AR Arezzo|AP Ascoli Piceno|AT Asti|AV Avellino|
      BA Bari|BT Barletta-Andria-Trani|BL Belluno|BN Benevento|BG Bergamo|BI Biella|BO Bologna|
      BZ Bolzano|BS Brescia|BR Brindisi|CA Cagliari|CL Caltanissetta|CB Campobasso|CE Caserta|
      CT Catania|CZ Catanzaro|CH Chieti|CO Como|CS Cosenza|CR Cremona|KR Crotone|CN Cuneo|EN Enna|
      FM Fermo|FE Ferrara|FI Firenze|FG Foggia|FC Forlì-Cesena|FR Frosinone|GE Genova|GO Gorizia|
      GR Grosseto|IM Imperia|IS Isernia|AQ L'Aquila|SP La Spezia|LT Latina|LE Lecce|LC Lecco|
      LI Livorno|LO Lodi|LU Lucca|MC Macerata|MN Mantova|MS Massa-Carrara|MT Matera|ME Messina|
      MI Milano|MO Modena|MB Monza e Brianza|NA Napoli|NO Novara|NU Nuoro|OR Oristano|PD Padova|
      PA Palermo|PR Parma|PV Pavia|PG Perugia|PU Pesaro e Urbino|PE Pescara|PC Piacenza|PI Pisa|
      PT Pistoia|PN Pordenone|PZ Potenza|PO Prato|RG Ragusa|RA Ravenna|RC Reggio Calabria|
      RE Reggio Emilia|RI Rieti|RN Rimini|RM Roma|RO Rovigo|SA Salerno|SS Sassari|SV Savona|SI Siena|
      SR Siracusa|SO Sondrio|SU Sud Sardegna|TA Taranto|TE Teramo|TR Terni|TO Torino|TP Trapani|
      TN Trento|TV Treviso|TS Trieste|UD Udine|VA Varese|VE Venezia|VB Verbano-Cusio-Ossola|
      VC Vercelli|VR Verona|VV Vibo Valentia|VI Vicenza|VT Viterbo`),
    regionDisplay: 'code',
  },
  // Correos addressing guide. The province is usually written but not required.
  ES: {
    parts: ['street', 'postalCode', 'city', 'region'],
    required: ['street', 'postalCode', 'city'],
    labels: { ...LABELS, region: 'Province' },
    regions: regionList(`
      C A Coruña|VI Álava|AB Albacete|A Alicante|AL Almería|O Asturias|AV Ávila|BA Badajoz|
      PM Baleares|B Barcelona|BI Bizkaia|BU Burgos|CC Cáceres|CA Cádiz|S Cantabria|CS Castellón|
      CE Ceuta|CR Ciudad Real|CO Córdoba|CU Cuenca|SS Gipuzkoa|GI Girona|GR Granada|GU Guadalajara|
      H Huelva|HU Huesca|J Jaén|LO La Rioja|GC Las Palmas|LE León|L Lleida|LU Lugo|M Madrid|
      MA Málaga|ML Melilla|MU Murcia|NA Navarra|OR Ourense|P Palencia|PO Pontevedra|SA Salamanca|
      TF Santa Cruz de Tenerife|SG Segovia|SE Sevilla|SO Soria|T Tarragona|TE Teruel|TO Toledo|
      V Valencia|VA Valladolid|ZA Zamora|Z Zaragoza`),
    regionDisplay: 'name',
  },
  // PostNL
  NL: postalCodeFirst('Postcode', splitRule('1234 AB', '^[1-9]\\d{3} [A-Z]{2}$', /^[1-9]\d{3}[A-Z]{2}$/, 4, ' ')),
  // bpost
  BE: postalCodeFirst(),
  // Deutsche Post
  DE: postalCodeFirst('Postal code', {
    example: '12345',
    pattern: '^\\d{5}$',
    numeric: true,
    normalize: (value) => (/^\d{5}$/.test(compact(value)) ? compact(value) : undefined),
  }),
  // Österreichische Post
  AT: postalCodeFirst(),
  // Swiss Post
  CH: postalCodeFirst(),
  // La Poste
  FR: postalCodeFirst(),
  // POST Luxembourg
  LU: postalCodeFirst(),
  // PostNord
  DK: postalCodeFirst(),
  // Posten Norge
  NO: postalCodeFirst(),
  // PostNord
  SE: postalCodeFirst(),
  // Posti
  FI: postalCodeFirst(),
  // Poczta Polska
  PL: postalCodeFirst(),
  // Česká pošta
  CZ: postalCodeFirst(),
  // CTT
  PT: postalCodeFirst(),
  // Royal Mail Address Management Guide
  GB: {
    parts: ['street', 'city', 'postalCode'],
    required: ['street', 'city', 'postalCode'],
    labels: { ...LABELS, city: 'Town/City', postalCode: 'Postcode' },
    regionDisplay: 'name',
    // Postcodes have several forms, so they're only normalized: the last
    // three characters are the inward code.
    postalCodeRule: {
      example: 'SW1A 1AA',
      normalize(value) {
        const code = compact(value);
        return /^[A-Z0-9]{5,7}$/.test(code) ? `${code.slice(0, -3)} ${code.slice(-3)}` : undefined;
      },
    },
  },
  // An Post. Since Eircode, the county is optional.
  IE: {
    parts: ['street', 'city', 'region', 'postalCode'],
    required: ['street', 'city'],
    labels: { ...LABELS, city: 'Town/City', region: 'County', postalCode: 'Eircode' },
    regionDisplay: 'name',
  },
};

function regionList(text: string): [string, string][] {
  return text
    .split('|')
    .map((entry) => entry.trim())
    .map((entry) => {
      const space = entry.indexOf(' ');
      return [entry.slice(0, space), entry.slice(space + 1)];
    });
}

/** The address format for a country, or the default format. */
export function addressFormat(country?: string): AddressFormat {
  return (country !== undefined && FORMATS[country.toUpperCase()]) || DEFAULT_FORMAT;
}

/** Countries with their own format, for tests and tools. */
export const ADDRESS_FORMAT_COUNTRIES: readonly string[] = Object.keys(FORMATS);

/**
 * Writes an address on one line, such as "Keizersgracht 1, 1015 AA Amsterdam, NL"
 * or "1 Main St, Springfield IL 62701, US".
 */
export function formatAddressLine(address: {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}): string {
  const format = addressFormat(address.country);
  let region = address.region;
  if (region && format.regionDisplay === 'name') {
    region = format.regions?.find(([code]) => code === region)?.[1] ?? region;
  }
  const street = (address.street ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  // The city, region and postal code go together, in the country's order.
  const locality = format.parts
    .filter((p) => p !== 'street')
    .map((p) => (p === 'region' ? region : address[p]))
    .filter(Boolean)
    .join(' ');
  return [...street, locality, address.country].filter(Boolean).join(', ');
}
