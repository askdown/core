import { E164 } from './phone.ts';
import { ADDRESS_FORMAT_COUNTRIES, addressFormat } from './address-formats.ts';
import { COUNTRY_CODES } from './countries.ts';
import { DEFAULT_MAX_LENGTH } from './validate-response.ts';
import { choiceValue, type Form, isQuestion, type Question, SUBMIT } from './types.ts';

/** A JSON Schema (draft 2020-12) document or subschema. */
export type JsonSchema = { [keyword: string]: unknown };

export interface ResponseSchemaOptions {
  /** Value for the schema's `$id`, such as the URL it's served from. */
  id?: string;
}

/**
 * Returns a JSON Schema (draft 2020-12) describing the responses to a form,
 * as produced by validateResponse().
 *
 * The schema describes the shape of a response and is looser than
 * validateResponse(), which stays authoritative: it can't express trimming,
 * accepted file types, date and time ranges, or that a question on a page
 * reached through a jump is only required when that page is visited. Only
 * required questions on pages every respondent visits are listed as
 * required.
 */
export function responseSchema(form: Form, options: ResponseSchemaOptions = {}): JsonSchema {
  const always = alwaysVisited(form);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  form.pages.forEach((page, idx) => {
    for (const item of page.items) {
      if (!isQuestion(item)) continue;
      properties[item.id] = {
        title: item.label,
        ...(item.help !== undefined && { description: item.help }),
        ...answerSchema(item),
      };
      if (item.required && always.has(idx)) required.push(item.id);
    }
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...(options.id !== undefined && { $id: options.id }),
    ...(form.title !== undefined && { title: form.title }),
    ...(form.description !== undefined && { description: form.description }),
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
    additionalProperties: false,
  };
}

const TIME = '^\\d{2}:\\d{2}(:\\d{2})?$';

const fileRef: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    size: { type: 'integer', minimum: 0 },
    type: { type: 'string' },
    uri: { type: 'string', format: 'uri-reference' },
  },
  required: ['name', 'size', 'type', 'uri'],
  additionalProperties: false,
};

function answerSchema(q: Question): JsonSchema {
  switch (q.type) {
    case 'text':
    case 'paragraph': {
      const schema: JsonSchema = {
        type: 'string',
        minLength: Math.max(1, q.minLength ?? 0),
        maxLength: q.maxLength ?? DEFAULT_MAX_LENGTH[q.type],
      };
      if (q.type === 'text' && q.pattern !== undefined && isValidPattern(q.pattern)) {
        schema.pattern = `^(?:${q.pattern})$`;
      }
      return schema;
    }
    case 'email':
      return { type: 'string', format: 'email', minLength: 1, maxLength: DEFAULT_MAX_LENGTH.other };
    case 'url':
      return { type: 'string', format: 'uri', pattern: '^https?:', maxLength: DEFAULT_MAX_LENGTH.other };
    case 'phone':
      return { type: 'string', pattern: E164.source };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'time':
      return { type: 'string', pattern: TIME };
    case 'number': {
      const schema: JsonSchema = { type: 'number' };
      if (q.min !== undefined) schema.minimum = q.min;
      if (q.max !== undefined) schema.maximum = q.max;
      // Steps count from min, which multipleOf can only express from 0.
      if (q.step !== undefined && (q.min ?? 0) === 0) schema.multipleOf = q.step;
      return schema;
    }
    case 'scale':
      return { type: 'integer', minimum: q.min, maximum: q.max };
    case 'rating':
      return { type: 'integer', minimum: 1, maximum: q.max };
    case 'radio':
    case 'select': {
      const values = { enum: q.options.map(choiceValue) };
      if (q.type === 'select' || q.other === undefined) return { type: 'string', ...values };
      return { anyOf: [values, { type: 'string', minLength: 1, maxLength: DEFAULT_MAX_LENGTH.other }] };
    }
    case 'checkbox': {
      const values = q.options.map(choiceValue);
      const schema: JsonSchema = {
        type: 'array',
        items: q.other === undefined ? { enum: values } : { type: 'string', minLength: 1, maxLength: DEFAULT_MAX_LENGTH.other },
        uniqueItems: true,
        minItems: Math.max(1, q.minSelected ?? 0),
      };
      if (q.maxSelected !== undefined) schema.maxItems = q.maxSelected;
      if (q.other !== undefined) {
        // At most one answer that isn't an option: the other text.
        schema.contains = { not: { enum: values } };
        schema.minContains = 0;
        schema.maxContains = 1;
      }
      return schema;
    }
    case 'ranking':
      return {
        type: 'array',
        items: { enum: q.options.map(choiceValue) },
        uniqueItems: true,
        minItems: q.options.length,
        maxItems: q.options.length,
      };
    case 'grid':
    case 'checkbox-grid': {
      const colValues = q.columns.map(choiceValue);
      const rowValues = q.rows.map(choiceValue);
      const cell: JsonSchema =
        q.type === 'grid'
          ? { enum: colValues }
          : { type: 'array', items: { enum: colValues }, uniqueItems: true, minItems: 1 };
      return {
        type: 'object',
        properties: Object.fromEntries(rowValues.map((row) => [row, cell])),
        // A required grid needs every row answered.
        ...(q.required ? { required: rowValues } : { minProperties: 1 }),
        additionalProperties: false,
      };
    }
    case 'address': {
      const base: JsonSchema = {
        type: 'object',
        properties: {
          street: ADDRESS_PART,
          city: ADDRESS_PART,
          region: ADDRESS_PART,
          postalCode: ADDRESS_PART,
          country: q.country === undefined ? { enum: COUNTRY_CODES } : { const: q.country },
        },
        required: ['street', 'city', 'country'],
        additionalProperties: false,
      };
      if (q.country !== undefined) {
        const rules = addressRules(q.country);
        return {
          ...base,
          properties: { ...(base.properties as object), ...(rules.properties as object) },
          required: [...(base.required as string[]), ...((rules.required as string[] | undefined) ?? [])],
        };
      }
      return {
        ...base,
        allOf: ADDRESS_FORMAT_COUNTRIES.map((country) => ({
          if: { properties: { country: { const: country } }, required: ['country'] },
          then: addressRules(country),
        })),
      };
    }
    case 'file':
      return {
        type: 'array',
        items: q.maxSize === undefined ? fileRef : withMaxSize(q.maxSize),
        minItems: 1,
        maxItems: q.maxFiles ?? 1,
      };
  }
}

const ADDRESS_PART: JsonSchema = { type: 'string', minLength: 1, maxLength: DEFAULT_MAX_LENGTH.other };

/** The rules for an address in one country: required parts, unused parts, and the region list. */
function addressRules(country: string): JsonSchema {
  const format = addressFormat(country);
  const properties: Record<string, JsonSchema | boolean> = {};
  const required: string[] = [];
  for (const part of ['region', 'postalCode'] as const) {
    if (!format.parts.includes(part)) {
      properties[part] = false;
      continue;
    }
    if (part === 'region' && format.regions) {
      properties.region = { enum: format.regions.map(([code]) => code) };
    } else if (part === 'postalCode' && format.postalCodeRule?.pattern !== undefined) {
      properties.postalCode = { ...ADDRESS_PART, pattern: format.postalCodeRule.pattern };
    } else if (format.required.includes(part)) {
      properties[part] = ADDRESS_PART;
    }
    if (format.required.includes(part)) required.push(part);
  }
  // Street, city and country are required for every country already.
  return { properties, ...(required.length > 0 && { required }) };
}

function withMaxSize(maxSize: number): JsonSchema {
  const properties = fileRef.properties as Record<string, JsonSchema>;
  return { ...fileRef, properties: { ...properties, size: { ...properties.size, maximum: maxSize } } };
}

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

/** Marks the end of the form in the page graph. */
const END = -1;

interface Edge {
  to: number;
  /** For an edge to END from stopping at a page visited twice: that page. */
  revisit?: number;
}

/**
 * Returns the indexes of the pages every respondent visits, whatever they
 * answer.
 */
function alwaysVisited(form: Form): Set<number> {
  const n = form.pages.length;
  const edges: Edge[][] = form.pages.map((page, idx) => {
    const following = idx + 1 < n ? idx + 1 : END;
    const resolve = (target: string | undefined): number => {
      if (target === SUBMIT) return END;
      const found = target === undefined ? -1 : form.pages.findIndex((p) => p.id === target);
      return found === -1 ? following : found;
    };
    const targets = new Set<number>([resolve(page.next)]);
    for (const item of page.items) {
      if (item.type !== 'radio' && item.type !== 'select') continue;
      for (const option of item.options) {
        if (option.goto !== undefined) targets.add(resolve(option.goto));
      }
    }
    return [...targets].map((to) => ({ to }));
  });

  // Navigation stops when a page would be visited twice. That can happen on
  // an edge u -> v when v leads back to u, so add a possible end there.
  const reaches = (from: number, to: number) => reachable(edges, from, -2).has(to);
  for (let u = 0; u < n; u++) {
    for (const { to: v } of [...edges[u]!]) {
      if (v !== END && reaches(v, u)) edges[u]!.push({ to: END, revisit: v });
    }
  }

  // A page is always visited when the form can't end without it.
  const always = new Set<number>();
  for (let p = 0; p < n; p++) {
    if (p === 0 || !reachable(edges, 0, p).has(END)) always.add(p);
  }
  return always;
}

/** Returns the nodes reachable from `start`, without passing `skip`. */
function reachable(edges: Edge[][], start: number, skip: number): Set<number> {
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const u = stack.pop()!;
    if (u === END) continue;
    for (const { to, revisit } of edges[u]!) {
      if (to === skip || revisit === skip || seen.has(to)) continue;
      seen.add(to);
      stack.push(to);
    }
  }
  return seen;
}
