/**
 * The Askdown JSON form model.
 *
 * This is the canonical representation of a form. The Askdown DSL is a
 * syntax for this model, and spec/askdown.schema.json describes it.
 */

/** Version of the spec this model conforms to. */
export const SPEC_VERSION = '0.1';

/** Special goto target that ends the form (submits). */
export const SUBMIT = 'submit';

export interface Form {
  askdown: typeof SPEC_VERSION;
  title?: string;
  /** Markdown */
  description?: string;
  settings?: FormSettings;
  pages: Page[];
}

export interface FormSettings {
  /** Label of the submit button. */
  submitLabel?: string;
  /** Markdown shown after a successful submission. */
  confirmation?: string;
}

export interface Page {
  id: string;
  title?: string;
  items: Item[];
  /** Page id to go to after this page, or "submit". Defaults to the next page. */
  next?: string;
}

export type Item = Content | Question;

export interface Content {
  type: 'content';
  /** Markdown */
  markdown: string;
}

interface QuestionBase {
  id: string;
  label: string;
  /** Markdown help text shown below the label. */
  help?: string;
  required?: boolean;
}

export interface TextQuestion extends QuestionBase {
  type: 'text';
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  /** Regular expression the whole answer must match. */
  pattern?: string;
}

export interface ParagraphQuestion extends QuestionBase {
  type: 'paragraph';
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
}

export interface EmailQuestion extends QuestionBase {
  type: 'email';
  placeholder?: string;
}

export interface UrlQuestion extends QuestionBase {
  type: 'url';
  placeholder?: string;
}

export interface PhoneQuestion extends QuestionBase {
  type: 'phone';
  placeholder?: string;
  /** ISO 3166-1 alpha-2 code of the country selected by default. The respondent can pick another. */
  country?: string;
}

export interface NumberQuestion extends QuestionBase {
  type: 'number';
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface DateQuestion extends QuestionBase {
  type: 'date';
  /** YYYY-MM-DD */
  min?: string;
  /** YYYY-MM-DD */
  max?: string;
}

export interface TimeQuestion extends QuestionBase {
  type: 'time';
  /** HH:MM */
  min?: string;
  /** HH:MM */
  max?: string;
}

export interface Option {
  label: string;
  /**
   * Stable value stored in responses. Defaults to the label, so it can stay
   * fixed while the label is reworded or translated. Values of "yes", "maybe"
   * and "no" are recognized for colouring (see Cell).
   */
  value?: string;
  /**
   * Presentation hints, emitted as classes/data attributes by renderers.
   * "positive", "neutral" and "negative" colour the choice; others are
   * free-form theme hooks.
   */
  flags?: string[];
  /** Selected by default. */
  default?: boolean;
  /** Page id to jump to when this option is chosen (radio and select only), or "submit". */
  goto?: string;
}

/**
 * A grid row or column. `value` defaults to `label` and is what a response
 * stores, so labels can be reworded or translated without changing responses.
 */
export interface Cell {
  label: string;
  value?: string;
  /**
   * Presentation hints (see Option.flags). A column whose value is "yes",
   * "maybe" or "no" (case-insensitive), or that carries a "positive",
   * "neutral" or "negative" flag, is coloured green/amber/red.
   */
  flags?: string[];
}

/** The stored value of an option or grid cell: its `value`, or its `label`. */
export function choiceValue(c: { label: string; value?: string }): string {
  return c.value ?? c.label;
}

export interface RadioQuestion extends QuestionBase {
  type: 'radio';
  options: Option[];
  /** When set, adds a free-text "other" option with this label. */
  other?: string;
  shuffle?: boolean;
}

export interface CheckboxQuestion extends QuestionBase {
  type: 'checkbox';
  options: Option[];
  other?: string;
  shuffle?: boolean;
  minSelected?: number;
  maxSelected?: number;
}

export interface SelectQuestion extends QuestionBase {
  type: 'select';
  options: Option[];
  shuffle?: boolean;
}

export interface RankingQuestion extends QuestionBase {
  type: 'ranking';
  /** The options to put in order. Defaults and jumps don't apply. */
  options: Option[];
  shuffle?: boolean;
}

export interface ScaleQuestion extends QuestionBase {
  type: 'scale';
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}

export interface RatingQuestion extends QuestionBase {
  type: 'rating';
  max: number;
}

export interface GridQuestion extends QuestionBase {
  type: 'grid' | 'checkbox-grid';
  rows: Cell[];
  columns: Cell[];
}

export interface FileQuestion extends QuestionBase {
  type: 'file';
  /** File extensions (".pdf") or media types ("image/*"). */
  accept?: string[];
  /** Maximum size per file, in bytes. */
  maxSize?: number;
  /** Maximum number of files. Defaults to 1. */
  maxFiles?: number;
}

export interface AddressQuestion extends QuestionBase {
  type: 'address';
  /** ISO 3166-1 alpha-2 code. When set, the country is fixed and not asked. */
  country?: string;
}

export type Question =
  | TextQuestion
  | ParagraphQuestion
  | EmailQuestion
  | UrlQuestion
  | PhoneQuestion
  | NumberQuestion
  | DateQuestion
  | TimeQuestion
  | RadioQuestion
  | CheckboxQuestion
  | SelectQuestion
  | RankingQuestion
  | ScaleQuestion
  | RatingQuestion
  | GridQuestion
  | FileQuestion
  | AddressQuestion;

export type QuestionType = Question['type'];

export const QUESTION_TYPES: readonly QuestionType[] = [
  'text',
  'paragraph',
  'email',
  'url',
  'phone',
  'number',
  'date',
  'time',
  'radio',
  'checkbox',
  'select',
  'ranking',
  'scale',
  'rating',
  'grid',
  'checkbox-grid',
  'file',
  'address',
];

export type ChoiceQuestion = RadioQuestion | CheckboxQuestion | SelectQuestion;

export function isQuestion(item: Item): item is Question {
  return item.type !== 'content';
}

export function isChoice(q: Question): q is ChoiceQuestion {
  return q.type === 'radio' || q.type === 'checkbox' || q.type === 'select';
}

/** An uploaded file, as stored in a response. */
export interface FileRef {
  name: string;
  size: number;
  /** Media type, or "" if unknown. */
  type: string;
  /**
   * URI reference to the file's contents: a data: URL, or an absolute or
   * relative URL where the file is stored. Required in a stored response;
   * a submission that hasn't been stored yet may not have one.
   */
  uri?: string;
}

/** A postal address, as stored in a response. Empty parts are left out. */
export interface Address {
  /** Street and house number; may span several lines. */
  street: string;
  city: string;
  /** State, province or similar. */
  region?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2 code */
  country: string;
}

/**
 * The value of a single answer.
 *
 * - text, paragraph, email, url, date, time, radio, select: string
 * - phone: string, in E.164 format ("+31612345678")
 * - number, scale, rating: number
 * - checkbox: string[]
 * - ranking: string[], every option value, highest ranked first
 * - grid: { [row value]: column value }
 * - checkbox-grid: { [row value]: column value[] }
 * - file: FileRef[]
 * - address: Address
 *
 * Choices store their `value` (which defaults to the `label`). For radio and
 * checkbox, a value that isn't one of the option values is the text of the
 * "other" option.
 */
export type AnswerValue =
  | string
  | number
  | string[]
  | Record<string, string>
  | Record<string, string[]>
  | FileRef[]
  | Address;

export type Answers = Record<string, AnswerValue>;

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** 1-based line number */
  line: number;
  /** 1-based column */
  column: number;
  /** 1-based column, exclusive */
  endColumn?: number;
}
