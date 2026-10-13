import { addressFormat } from './address-formats.ts';
import { toE164 } from './phone.ts';
import { isCountryCode } from './countries.ts';
import { visitedPages } from './navigation.ts';
import { formatSize } from './parse.ts';
import {
  type Address,
  type Answers,
  type AnswerValue,
  choiceValue,
  type FileRef,
  type Form,
  isQuestion,
  type Question,
} from './types.ts';

export interface AnswerError {
  /** Question id */
  id: string;
  message: string;
}

export interface ResponseValidation {
  valid: boolean;
  errors: AnswerError[];
  /** Normalized answers, limited to questions on visited pages. */
  answers: Answers;
  /** Indexes of the pages the respondent visited. */
  pages: number[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Default length limits for text answers when a question sets none. These
 * also bound the input that author-supplied patterns run against.
 */
export const DEFAULT_MAX_LENGTH = { text: 1000, paragraph: 50000, other: 1000 } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export interface AnswerCheck {
  /** The normalized value, or undefined when there is no answer. */
  value?: AnswerValue;
  error?: string;
}

/**
 * Normalizes and validates the answer to a single question.
 *
 * Accepts loose input, such as numbers as strings or a single string for a
 * checkbox question, which is what HTML forms produce.
 */
export function checkAnswer(q: Question, input: unknown): AnswerCheck {
  const result = normalize(q, input);
  if (result.error) return result;
  if (result.value === undefined) {
    return q.required ? { error: 'This question is required.' } : {};
  }
  return result;
}

function normalize(q: Question, input: unknown): AnswerCheck {
  if (input === undefined || input === null) return {};
  switch (q.type) {
    case 'phone': {
      if (typeof input !== 'string') return { error: 'Expected text.' };
      const text = input.trim();
      if (text === '') return {};
      const value = toE164(text);
      if (value === undefined) return { error: 'Enter a valid phone number, including the country code.' };
      return { value };
    }
    case 'text':
    case 'paragraph':
    case 'email':
    case 'url':
    case 'date':
    case 'time': {
      if (typeof input !== 'string') return { error: 'Expected text.' };
      const value = q.type === 'paragraph' ? input.replace(/^\s*\n|\s+$/g, '') : input.trim();
      if (value === '') return {};
      const length = [...value].length;
      const limit =
        q.type === 'paragraph' ? DEFAULT_MAX_LENGTH.paragraph : q.type === 'text' ? DEFAULT_MAX_LENGTH.text : DEFAULT_MAX_LENGTH.other;
      if ((q.type !== 'text' && q.type !== 'paragraph') || q.maxLength === undefined) {
        if (length > limit) return { error: `Enter at most ${limit} characters.` };
      }
      if (q.type === 'text' || q.type === 'paragraph') {
        if (q.minLength !== undefined && length < q.minLength) {
          return { error: `Enter at least ${q.minLength} characters.` };
        }
        if (q.maxLength !== undefined && length > q.maxLength) {
          return { error: `Enter at most ${q.maxLength} characters.` };
        }
      }
      if (q.type === 'text' && q.pattern !== undefined) {
        let re: RegExp;
        try {
          re = new RegExp(`^(?:${q.pattern})$`, 'u');
        } catch {
          return { value };
        }
        if (!re.test(value)) return { error: 'The answer is not in the expected format.' };
      }
      if (q.type === 'email' && !EMAIL.test(value)) {
        return { error: 'Enter a valid email address.' };
      }
      if (q.type === 'url') {
        let url: URL | undefined;
        try {
          url = new URL(value);
        } catch {}
        if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
          return { error: 'Enter a valid URL, starting with https://.' };
        }
      }
      if (q.type === 'date') {
        if (!DATE.test(value) || Number.isNaN(Date.parse(value))) return { error: 'Enter a valid date.' };
        if (q.min !== undefined && value < q.min) return { error: `Enter a date on or after ${q.min}.` };
        if (q.max !== undefined && value > q.max) return { error: `Enter a date on or before ${q.max}.` };
      }
      if (q.type === 'time') {
        if (!TIME.test(value)) return { error: 'Enter a valid time.' };
        if (q.min !== undefined && value < q.min) return { error: `Enter a time at or after ${q.min}.` };
        if (q.max !== undefined && value > q.max) return { error: `Enter a time at or before ${q.max}.` };
      }
      return { value };
    }

    case 'number':
    case 'scale':
    case 'rating': {
      let value: number;
      if (typeof input === 'number') {
        value = input;
      } else if (typeof input === 'string') {
        if (input.trim() === '') return {};
        value = Number(input);
      } else {
        return { error: 'Expected a number.' };
      }
      if (!Number.isFinite(value)) return { error: 'Enter a number.' };
      const min = q.type === 'rating' ? 1 : q.min;
      const max = q.max;
      if (q.type !== 'number' && !Number.isInteger(value)) return { error: 'Choose one of the values.' };
      if (min !== undefined && value < min) return { error: `Enter a number of at least ${min}.` };
      if (max !== undefined && value > max) return { error: `Enter a number of at most ${max}.` };
      if (q.type === 'number' && q.step !== undefined) {
        const base = q.min ?? 0;
        const steps = (value - base) / q.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-9) return { error: `Enter a multiple of ${q.step}.` };
      }
      return { value };
    }

    case 'radio':
    case 'select': {
      if (typeof input !== 'string') return { error: 'Expected text.' };
      const value = input.trim();
      if (value === '') return {};
      if (value.length > DEFAULT_MAX_LENGTH.other) return { error: `Enter at most ${DEFAULT_MAX_LENGTH.other} characters.` };
      if (!q.options.some((o) => choiceValue(o) === value) && (q.type === 'select' || q.other === undefined)) {
        return { error: 'Choose one of the options.' };
      }
      return { value };
    }

    case 'checkbox': {
      const list = typeof input === 'string' ? [input] : input;
      if (!Array.isArray(list) || list.some((v) => typeof v !== 'string')) {
        return { error: 'Expected a list of options.' };
      }
      const value = [...new Set((list as string[]).map((v) => v.trim()).filter(Boolean))];
      if (!value.length) return {};
      if (value.some((v) => v.length > DEFAULT_MAX_LENGTH.other)) {
        return { error: `Enter at most ${DEFAULT_MAX_LENGTH.other} characters.` };
      }
      const others = value.filter((v) => !q.options.some((o) => choiceValue(o) === v));
      if (others.length > (q.other !== undefined ? 1 : 0)) return { error: 'Choose from the options.' };
      if (q.minSelected !== undefined && value.length < q.minSelected) {
        return { error: `Choose at least ${q.minSelected}.` };
      }
      if (q.maxSelected !== undefined && value.length > q.maxSelected) {
        return { error: `Choose at most ${q.maxSelected}.` };
      }
      // Keep the order of the options, with "other" last.
      const order = (v: string) => {
        const idx = q.options.findIndex((o) => choiceValue(o) === v);
        return idx === -1 ? q.options.length : idx;
      };
      return { value: value.sort((a, b) => order(a) - order(b)) };
    }

    case 'ranking': {
      if (!Array.isArray(input) || input.some((v) => typeof v !== 'string')) {
        return { error: 'Expected a list of options.' };
      }
      const value = (input as string[]).map((v) => v.trim()).filter(Boolean);
      if (!value.length) return {};
      if (value.some((v) => !q.options.some((o) => choiceValue(o) === v)) || new Set(value).size !== value.length) {
        return { error: 'Rank each option once.' };
      }
      if (value.length !== q.options.length) return { error: 'Rank all of the options.' };
      return { value };
    }

    case 'grid':
    case 'checkbox-grid': {
      if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Expected an answer per row.' };
      const rowValues = q.rows.map(choiceValue);
      const colValues = q.columns.map(choiceValue);
      const value: Record<string, string | string[]> = {};
      for (const [row, raw] of Object.entries(input as Record<string, unknown>)) {
        if (!rowValues.includes(row)) return { error: `Unknown row "${row}".` };
        const cols = typeof raw === 'string' ? [raw] : raw;
        if (!Array.isArray(cols) || cols.some((c) => typeof c !== 'string' || !colValues.includes(c))) {
          return { error: `Choose one of the columns for "${row}".` };
        }
        const chosen = colValues.filter((c) => (cols as string[]).includes(c));
        if (!chosen.length) continue;
        if (q.type === 'grid') {
          if (chosen.length > 1) return { error: `Choose one column for "${row}".` };
          value[row] = chosen[0]!;
        } else {
          value[row] = chosen;
        }
      }
      if (!Object.keys(value).length) return {};
      if (q.required) {
        const missing = q.rows.find((r) => !(choiceValue(r) in value));
        if (missing) return { error: `Answer "${missing.label}".` };
      }
      // Keep row order
      const ordered = Object.fromEntries(rowValues.filter((r) => r in value).map((r) => [r, value[r]!]));
      return { value: ordered as AnswerValue };
    }

    case 'file': {
      const list = Array.isArray(input) ? input : [input];
      const files: FileRef[] = [];
      for (const f of list) {
        if (typeof f !== 'object' || f === null || typeof (f as FileRef).name !== 'string' || typeof (f as FileRef).size !== 'number') {
          return { error: 'Expected a file.' };
        }
        const file = f as FileRef;
        if (file.size === 0 && file.name === '') continue;
        files.push({
          name: file.name,
          size: file.size,
          type: typeof file.type === 'string' ? file.type : '',
          ...(typeof file.uri === 'string' ? { uri: file.uri } : {}),
        });
      }
      if (!files.length) return {};
      const maxFiles = q.maxFiles ?? 1;
      if (files.length > maxFiles) return { error: `Upload at most ${maxFiles} ${maxFiles === 1 ? 'file' : 'files'}.` };
      for (const file of files) {
        if (q.maxSize !== undefined && file.size > q.maxSize) {
          return { error: `"${file.name}" is larger than ${formatSize(q.maxSize)}.` };
        }
        if (q.accept?.length && !accepts(q.accept, file)) {
          return { error: `"${file.name}" is not an accepted file type.` };
        }
      }
      return { value: files };
    }

    case 'address': {
      if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Expected an address.' };
      const parts: Record<string, string> = {};
      for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
        if (!ADDRESS_PARTS.includes(key)) return { error: `Unknown address part "${key}".` };
        if (typeof raw !== 'string') return { error: 'Expected text.' };
        const value = raw.trim();
        if (value.length > DEFAULT_MAX_LENGTH.other) return { error: `Enter at most ${DEFAULT_MAX_LENGTH.other} characters.` };
        if (value !== '') parts[key] = value;
      }
      // A fixed country isn't asked, so it doesn't count as an answer.
      const country = parts.country?.toUpperCase();
      if (country === undefined || country === q.country) delete parts.country;
      if (!Object.keys(parts).length) return {};
      if (q.country !== undefined && country !== undefined && country !== q.country) {
        return { error: 'Enter an address in the given country.' };
      }
      const code = q.country ?? country;
      if (code === undefined) return { error: 'Choose a country.' };
      if (!isCountryCode(code)) return { error: 'Choose one of the countries.' };
      // Parts the country doesn't use are dropped, such as a region left over
      // from another country.
      const format = addressFormat(code);
      for (const part of format.parts) {
        if (!format.required.includes(part) || parts[part]) continue;
        const label = lowerLabel(format.labels[part]);
        return { error: part === 'region' && format.regions ? `Choose a ${label}.` : `Enter the ${label}.` };
      }
      let region = format.parts.includes('region') ? parts.region : undefined;
      if (region && format.regions) {
        const upper = region.toUpperCase();
        if (!format.regions.some(([c]) => c === upper)) {
          return { error: `Choose a ${lowerLabel(format.labels.region)} from the list.` };
        }
        region = upper;
      }
      let postalCode = format.parts.includes('postalCode') ? parts.postalCode : undefined;
      const rule = format.postalCodeRule;
      if (postalCode && rule) {
        postalCode = rule.normalize(postalCode) ?? postalCode;
        if (rule.pattern !== undefined && !new RegExp(rule.pattern).test(postalCode)) {
          return { error: `Enter a ${lowerLabel(format.labels.postalCode)} like ${rule.example}.` };
        }
      }
      const value: Address = {
        street: parts.street!,
        city: parts.city!,
        ...(region && { region }),
        ...(postalCode && { postalCode }),
        country: code,
      };
      return { value };
    }
  }
}

const ADDRESS_PARTS = ['street', 'city', 'region', 'postalCode', 'country'];

/** "Postal code" becomes "postal code", but "ZIP code" stays. */
function lowerLabel(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label;
}

/** Checks a file against an HTML-style accept list. */
export function accepts(accept: string[], file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((a) => {
    const rule = a.toLowerCase();
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/**
 * Validates a response against a form.
 *
 * Questions on pages the respondent skipped (because of jumps) are ignored,
 * and their answers are dropped.
 */
export function validateResponse(form: Form, input: Record<string, unknown>): ResponseValidation {
  const checked = new Map<string, AnswerCheck>();
  const normalized: Answers = {};
  for (const page of form.pages) {
    for (const item of page.items) {
      if (!isQuestion(item)) continue;
      const check = checkAnswer(item, input[item.id]);
      checked.set(item.id, check);
      if (check.value !== undefined) normalized[item.id] = check.value;
    }
  }

  const pages = visitedPages(form, normalized);
  const answers: Answers = {};
  const errors: AnswerError[] = [];
  for (const idx of pages) {
    for (const item of form.pages[idx]!.items) {
      if (!isQuestion(item)) continue;
      const check = checked.get(item.id)!;
      if (check.error) errors.push({ id: item.id, message: check.error });
      else if (check.value !== undefined) answers[item.id] = check.value;
    }
  }
  return { valid: errors.length === 0, errors, answers, pages };
}
