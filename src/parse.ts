import { isCountryCode } from './countries.ts';
import { phoneCode } from './phone.ts';
import { ID_PATTERN, slugify, uniqueId } from './ids.ts';
import {
  type Diagnostic,
  type Form,
  type FormSettings,
  type Option,
  type Page,
  type Question,
  type QuestionType,
  QUESTION_TYPES,
  SPEC_VERSION,
  SUBMIT,
} from './types.ts';

export interface SourceLocation {
  /** 1-based line number */
  line: number;
  /** Whether the id was written explicitly with {#id} */
  explicitId: boolean;
}

export interface ParseResult {
  form: Form;
  diagnostics: Diagnostic[];
  /** Where each question and page was defined. */
  locations: {
    questions: Record<string, SourceLocation>;
    pages: Record<string, SourceLocation>;
  };
}

export const PAGE_BREAK = /^---+\s*(?:\{([^}]*)\})?\s*(?:->\s*(\S+))?\s*$/;
export const QUESTION_START = /^\?\s+(.*)$/;
const HELP = /^>\s?(.*)$/;
const TYPE_SPEC = /^\[([A-Za-z][\w-]*)((?:\s.*)?)\]\s*$/;
const BLANKS = /^_{3,}\s*$/;
const OPTION = /^[-*+]\s+(?:(\(\s?\)|\([xX]\)|\[\s?\]|\[[xX]\])\s+)?(.*)$/;
const NUMBERED_OPTION = /^\d{1,9}[.)]\s+(.*)$/;
const TABLE_ROW = /^\|.*$/;
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const GOTO_SUFFIX = /\s+->\s*(\S+)\s*$/;
const OTHER = /^(.*?):?\s*_{3,}$/;
const FENCE = /^\s*(```|~~~)/;
const ATTR_BLOCK = /\s*\{([^{}]*)\}\s*$/;

const TYPE_ALIASES: Record<string, QuestionType> = {
  checkboxes: 'checkbox',
  dropdown: 'select',
  textarea: 'paragraph',
};

const SETTINGS_KEYS: Record<string, keyof FormSettings> = {
  submit: 'submitLabel',
  confirmation: 'confirmation',
};

/** Settings from earlier drafts of the spec, with what to do instead. */
const REMOVED_SETTINGS: Record<string, string> = {
  collectEmail: 'Add an [email] question instead.',
  limitOne: 'Limiting responses per respondent is up to the host.',
};

interface Goto {
  target: string;
  line: number;
  column: number;
  fromPage: number;
  /** Set for page jumps, to detect duplicates. */
  page?: Page;
  apply(id: string): void;
}

interface PendingQuestion {
  question: Question;
  explicitId?: string;
  line: number;
}

interface PendingPage {
  page: Page;
  explicitId?: string;
  line: number;
}

/**
 * Parses Askdown source text into a form.
 *
 * This never throws: problems are reported as diagnostics, and the parser
 * recovers as best it can.
 */
export function parse(source: string): ParseResult {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const diagnostics: Diagnostic[] = [];
  const form: Form = { askdown: SPEC_VERSION, pages: [] };
  const settings: FormSettings = {};
  const pages: PendingPage[] = [];
  const questions: PendingQuestion[] = [];
  const gotos: Goto[] = [];

  const error = (line: number, message: string, column = 1, endColumn?: number) =>
    diagnostics.push({ severity: 'error', message, line, column, endColumn });
  const warn = (line: number, message: string, column = 1, endColumn?: number) =>
    diagnostics.push({ severity: 'warning', message, line, column, endColumn });

  let i = 0;

  // Front matter
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end === -1) {
      error(1, 'Front matter is not closed. Add a line with --- after the settings.');
      i = 1;
    } else {
      parseFrontMatter(lines, 1, end, form, settings, error, warn);
      i = end + 1;
    }
  }

  let page: PendingPage = { page: { id: '', items: [] }, line: i + 1 };
  pages.push(page);
  let content: { line: number; text: string }[] = [];
  let inFence = false;
  let lastWasQuestion = false;

  const flushContent = () => {
    while (content.length && content[0]!.text.trim() === '') content.shift();
    while (content.length && content[content.length - 1]!.text.trim() === '') content.pop();
    if (content.length) {
      const atPageStart = page.page.items.length === 0 && page.page.title === undefined;
      const markdown = content
        .map((c, idx) => {
          const text = c.text.replace(/^\\([?]|->)/, '$1');
          return atPageStart && idx === 0 ? text.replace(/^\\(#\s)/, '$1') : text;
        })
        .join('\n');
      page.page.items.push({ type: 'content', markdown });
    }
    content = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    if (inFence) {
      content.push({ line: lineNo, text: line });
      if (FENCE.test(line)) inFence = false;
      continue;
    }

    const pageBreak = PAGE_BREAK.exec(line);
    if (pageBreak) {
      flushContent();
      lastWasQuestion = false;
      const isLeading =
        pages.length === 1 &&
        page.page.items.length === 0 &&
        page.page.title === undefined &&
        page.explicitId === undefined;
      if (!isLeading) {
        page = { page: { id: '', items: [] }, line: lineNo };
        pages.push(page);
      } else {
        page.line = lineNo;
      }
      const [, attrs, next] = pageBreak;
      if (attrs !== undefined) {
        const col = line.indexOf('{') + 1;
        const id = parseIdAttrs(attrs, lineNo, col, error, warn);
        if (id) page.explicitId = id;
      }
      if (next !== undefined) {
        const target = parseTarget(next, lineNo, line.lastIndexOf(next) + 1, error);
        if (target) {
          const p = page.page;
          gotos.push({
            target,
            line: lineNo,
            column: line.lastIndexOf(next) + 1,
            fromPage: pages.length - 1,
            page: p,
            apply: (id) => (p.next = id),
          });
        }
      }
      continue;
    }

    const questionStart = QUESTION_START.exec(line);
    if (questionStart) {
      flushContent();
      let end = i + 1;
      while (
        end < lines.length &&
        lines[end]!.trim() !== '' &&
        !PAGE_BREAK.test(lines[end]!) &&
        !QUESTION_START.test(lines[end]!)
      ) {
        end++;
      }
      const pending = parseQuestion(lines, i, end, pages.length - 1, gotos, error, warn);
      if (pending) {
        page.page.items.push(pending.question);
        questions.push(pending);
      }
      i = end - 1;
      lastWasQuestion = true;
      continue;
    }

    // A jump on its own line sets where to go after this page.
    const pageJump = /^->\s*(\S+)\s*$/.exec(line);
    if (pageJump) {
      flushContent();
      lastWasQuestion = false;
      const column = line.indexOf(pageJump[1]!) + 1;
      const target = parseTarget(pageJump[1]!, lineNo, column, error);
      if (target) {
        const p = page.page;
        if (gotos.some((g) => g.page === p)) {
          error(lineNo, 'This page already has a jump.');
        } else {
          gotos.push({ target, line: lineNo, column, fromPage: pages.length - 1, page: p, apply: (id) => (p.next = id) });
        }
      }
      continue;
    }

    // Page title: a level 1 heading before anything else on the page.
    const heading = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (
      heading &&
      page.page.items.length === 0 &&
      page.page.title === undefined &&
      content.every((c) => c.text.trim() === '')
    ) {
      content = [];
      if (pages.length === 1 && form.title === undefined) {
        form.title = heading[1]!;
      } else {
        page.page.title = heading[1]!;
      }
      continue;
    }

    if (
      lastWasQuestion &&
      line.trim() !== '' &&
      content.every((c) => c.text.trim() === '') &&
      looksLikeAnswer(line.trimStart())
    ) {
      warn(
        lineNo,
        'This line looks like part of the question above, but a blank line separates them. Remove the blank line to attach it.',
      );
    }
    if (line.trim() !== '') lastWasQuestion = false;

    if (FENCE.test(line)) inFence = true;
    content.push({ line: lineNo, text: line });
  }
  flushContent();

  // Assign page ids
  const pageIds = new Set<string>();
  const pageLocations: Record<string, SourceLocation> = {};
  for (const p of pages) {
    if (p.explicitId) {
      if (pageIds.has(p.explicitId)) {
        error(p.line, `Duplicate page id "${p.explicitId}".`);
      }
      pageIds.add(p.explicitId);
    }
  }
  pages.forEach((p, idx) => {
    p.page.id =
      p.explicitId ??
      uniqueId(p.page.title ? slugify(p.page.title, 'page') : `page-${idx + 1}`, pageIds);
    pageLocations[p.page.id] = { line: p.line, explicitId: p.explicitId !== undefined };
    if (p.page.items.length === 0 && p.page.title === undefined && pages.length > 1) {
      warn(p.line, 'This page is empty.');
    }
  });

  // Assign question ids
  const questionIds = new Set<string>();
  const questionLocations: Record<string, SourceLocation> = {};
  for (const q of questions) {
    if (q.explicitId) {
      if (questionIds.has(q.explicitId)) {
        error(q.line, `Duplicate question id "${q.explicitId}".`);
      }
      questionIds.add(q.explicitId);
    }
  }
  for (const q of questions) {
    q.question.id = q.explicitId ?? uniqueId(slugify(q.question.label), questionIds);
    questionLocations[q.question.id] ??= { line: q.line, explicitId: q.explicitId !== undefined };
  }

  // Resolve jumps
  const pageIndex = new Map(pages.map((p, idx) => [p.page.id, idx]));
  for (const g of gotos) {
    if (g.target === SUBMIT) {
      g.apply(SUBMIT);
      continue;
    }
    const target = pageIndex.get(g.target);
    if (target === undefined) {
      error(g.line, `There is no page with id "${g.target}".`, g.column, g.column + g.target.length + 1);
      continue;
    }
    if (target <= g.fromPage) {
      warn(g.line, `Jumping back to page "${g.target}" can create a loop.`, g.column);
    }
    g.apply(g.target);
  }

  const result: Form = {
    askdown: SPEC_VERSION,
    ...(form.title !== undefined ? { title: form.title } : {}),
    ...(form.description !== undefined ? { description: form.description } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
    pages: pages.map(({ page: { id, title, next, items } }) => ({
      id,
      ...(title !== undefined ? { title } : {}),
      ...(next !== undefined ? { next } : {}),
      items: items.map((item) => {
        if (item.type === 'content') return item;
        const { id, type, label, help, required, ...rest } = item;
        return {
          id,
          type,
          label,
          ...(help !== undefined ? { help } : {}),
          ...(required ? { required } : {}),
          ...rest,
        } as Question;
      }),
    })),
  };

  return {
    form: result,
    diagnostics: diagnostics.sort((a, b) => a.line - b.line || a.column - b.column),
    locations: { questions: questionLocations, pages: pageLocations },
  };
}

function looksLikeAnswer(line: string): boolean {
  return (
    BLANKS.test(line) ||
    TYPE_SPEC.test(line) ||
    /^[-*+]\s+(\(\s?\)|\([xX]\)|\[\s?\]|\[[xX]\])/.test(line)
  );
}

type Report = (line: number, message: string, column?: number, endColumn?: number) => void;

function parseFrontMatter(
  lines: string[],
  start: number,
  end: number,
  form: Form,
  settings: FormSettings,
  error: Report,
  warn: Report,
) {
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      error(i + 1, 'Expected "key: value".');
      continue;
    }
    const key = m[1]!;
    let raw = m[2]!.trim();
    let value: string | boolean;
    if (raw === '|' || raw === '>') {
      const block: string[] = [];
      while (i + 1 < end && (lines[i + 1]!.trim() === '' || /^\s/.test(lines[i + 1]!))) {
        block.push(lines[++i]!);
      }
      const indent = Math.min(
        ...block.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length),
      );
      const text = block.map((l) => l.slice(indent)).join('\n').replace(/\s+$/, '');
      value = raw === '>' ? text.replace(/([^\n])\n(?=[^\n])/g, '$1 ') : text;
    } else {
      value = parseScalar(raw, i + 1, error);
    }

    if (key === 'title' || key === 'description') {
      form[key] = String(value);
    } else if (key in SETTINGS_KEYS) {
      settings[SETTINGS_KEYS[key]!] = String(value);
    } else if (key in REMOVED_SETTINGS) {
      warn(i + 1, `"${key}" is no longer supported. ${REMOVED_SETTINGS[key]}`, 1, key.length + 1);
    } else {
      warn(i + 1, `Unknown setting "${key}".`, 1, key.length + 1);
    }
  }
}

function parseScalar(raw: string, line: number, error: Report): string | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      error(line, 'Invalid quoted string.');
      return raw;
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  // Strip trailing comments
  return raw.replace(/\s+#.*$/, '');
}

function parseIdAttrs(
  attrs: string,
  line: number,
  column: number,
  error: Report,
  warn: Report,
): string | undefined {
  let id: string | undefined;
  for (const token of attrs.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('#')) {
      const candidate = token.slice(1);
      if (!ID_PATTERN.test(candidate)) {
        error(
          line,
          `Invalid id "${candidate}". Ids contain letters, digits, - and _, and start with a letter or digit.`,
          column,
        );
      } else {
        id = candidate;
      }
    } else {
      warn(line, `Unknown attribute "${token}".`, column);
    }
  }
  return id;
}

/**
 * Pulls a trailing `{value .flag .flag}` block off a choice label (an option
 * or a grid cell). A bare token is the value; `.token`s are flags.
 */
function parseChoiceLabel(
  text: string,
  line: number,
  warn: Report,
): { label: string; value?: string; flags?: string[] } {
  const m = ATTR_BLOCK.exec(text);
  if (!m) return { label: text.trim() };
  const label = text.slice(0, m.index).trim();
  const column = text.lastIndexOf('{') + 1;
  let value: string | undefined;
  const flags: string[] = [];
  for (const token of m[1]!.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('.')) {
      const flag = token.slice(1).toLowerCase();
      if (flag && !flags.includes(flag)) flags.push(flag);
    } else if (token.startsWith('#')) {
      warn(line, 'Ids are not allowed on options or grid cells.', column);
    } else if (value === undefined) {
      value = token;
    } else {
      warn(line, `Unexpected attribute "${token}".`, column);
    }
  }
  return { label, ...(value !== undefined ? { value } : {}), ...(flags.length ? { flags } : {}) };
}

function parseTarget(raw: string, line: number, column: number, error: Report): string | undefined {
  if (raw === SUBMIT) return SUBMIT;
  if (raw.startsWith('#') && ID_PATTERN.test(raw.slice(1))) return raw.slice(1);
  error(line, `Invalid jump target "${raw}". Use #page-id or submit.`, column);
  return undefined;
}

type Marker = 'radio' | 'checkbox' | 'numbered' | 'plain';

interface ParsedOption {
  option: Option;
  marker: Marker;
  line: number;
  goto?: { target: string; column: number };
}

function parseQuestion(
  lines: string[],
  start: number,
  end: number,
  pageIdx: number,
  gotos: Goto[],
  error: Report,
  warn: Report,
): PendingQuestion | undefined {
  const lineNo = start + 1;
  let header = QUESTION_START.exec(lines[start]!)![1]!;
  let explicitId: string | undefined;

  const attrs = ATTR_BLOCK.exec(header);
  if (attrs) {
    explicitId = parseIdAttrs(attrs[1]!, lineNo, lines[start]!.lastIndexOf('{') + 1, error, warn);
    header = header.slice(0, attrs.index);
  }
  let required = false;
  header = header.trim();
  if (header.endsWith('*')) {
    required = true;
    header = header.slice(0, -1).trim();
  }
  if (!header) {
    error(lineNo, 'Question has no label.');
    return undefined;
  }

  const help: string[] = [];
  let typeSpec: { name: string; args: string; line: number } | undefined;
  let blanks = 0;
  const options: ParsedOption[] = [];
  let other: { label: string; marker: Marker; line: number } | undefined;
  const table: { cells: string[]; line: number }[] = [];

  for (let i = start + 1; i < end; i++) {
    const raw = lines[i]!;
    const line = raw.trimStart();
    const ln = i + 1;
    const indent = raw.length - line.length;
    let m: RegExpExecArray | null;

    if ((m = HELP.exec(line))) {
      help.push(m[1]!);
    } else if ((m = TYPE_SPEC.exec(line))) {
      if (typeSpec) error(ln, 'A question can only have one [type].', indent + 1);
      else typeSpec = { name: m[1]!, args: m[2]!.trim(), line: ln };
    } else if (BLANKS.test(line)) {
      blanks++;
    } else if ((m = OPTION.exec(line)) || (m = NUMBERED_OPTION.exec(line))) {
      const numbered = m.length === 2;
      const markerText = numbered ? undefined : m[1];
      const marker: Marker = numbered
        ? 'numbered'
        : !markerText
          ? 'plain'
          : markerText.startsWith('(')
            ? 'radio'
            : 'checkbox';
      let text = m[m.length - 1]!.trim();
      const option: Option = { label: '' };
      if (markerText && /[xX]/.test(markerText)) option.default = true;

      let gotoTarget: ParsedOption['goto'];
      const goto = GOTO_SUFFIX.exec(text);
      if (goto) {
        const column = raw.lastIndexOf(goto[1]!) + 1;
        const target = parseTarget(goto[1]!, ln, column, error);
        if (target) gotoTarget = { target, column };
        text = text.slice(0, goto.index).trim();
      }

      const otherMatch = OTHER.exec(text);
      if (otherMatch) {
        if (other) error(ln, 'A question can only have one "other" option.', indent + 1);
        other = { label: otherMatch[1]!.trim() || 'Other', marker, line: ln };
        if (goto) warn(ln, 'Jumps are not supported on the "other" option.', indent + 1);
        continue;
      }
      const parsed = parseChoiceLabel(text, ln, warn);
      if (!parsed.label) {
        error(ln, 'Option has no label.', indent + 1);
        continue;
      }
      option.label = parsed.label;
      if (parsed.value !== undefined) option.value = parsed.value;
      if (parsed.flags) option.flags = parsed.flags;
      const effValue = option.value ?? option.label;
      if (options.some((o) => (o.option.value ?? o.option.label) === effValue)) {
        error(ln, `Duplicate option "${effValue}".`, indent + 1);
        continue;
      }
      options.push({ option, marker, line: ln, goto: gotoTarget });
    } else if (TABLE_ROW.test(line)) {
      if (!TABLE_SEPARATOR.test(line)) {
        table.push({ cells: splitRow(line), line: ln });
      }
    } else {
      error(
        ln,
        'Unexpected line in question. Separate questions and text with a blank line.',
        indent + 1,
      );
    }
  }

  // Determine the type
  let type: QuestionType;
  const markers = new Set(options.map((o) => o.marker));
  if (other) markers.add(other.marker);
  const typeLine = typeSpec?.line ?? lineNo;
  if (typeSpec) {
    const name = TYPE_ALIASES[typeSpec.name] ?? typeSpec.name;
    if (!(QUESTION_TYPES as readonly string[]).includes(name)) {
      error(typeLine, `Unknown question type "${typeSpec.name}".`);
      type = 'text';
    } else {
      type = name as QuestionType;
    }
  } else if (options.length || other) {
    markers.delete('plain');
    if (markers.size > 1) {
      error(
        lineNo,
        markers.has('numbered')
          ? 'Mix of numbered and ( ) or [ ] options. Use numbered options only for a ranking.'
          : 'Mix of ( ) and [ ] options. Use ( ) for single choice or [ ] for multiple choice.',
      );
    }
    type = markers.has('numbered') ? 'ranking' : markers.has('checkbox') ? 'checkbox' : 'radio';
  } else if (table.length) {
    type = 'grid';
  } else if (blanks >= 2) {
    type = 'paragraph';
  } else {
    type = 'text';
  }

  const base = { id: '', label: header, ...(help.length ? { help: help.join('\n') } : {}) };
  const withRequired = <T extends object>(q: T): T => (required ? { ...q, required: true } : q);
  const args = parseArgs(typeSpec?.args ?? '', typeLine, error);
  const known = new Set<string>();
  const str = (key: string) => {
    known.add(key);
    const v = args.named[key];
    return v === undefined ? undefined : v;
  };
  const num = (key: string, integer = false) => {
    const v = str(key);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n))) {
      error(typeLine, `"${key}" must be ${integer ? 'a whole number' : 'a number'}.`);
      return undefined;
    }
    return n;
  };
  const flag = (key: string) => {
    known.add(key);
    return args.flags.has(key) || undefined;
  };
  const clean = <T extends object>(q: T): T =>
    Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as T;

  const hasOptions = type === 'radio' || type === 'checkbox' || type === 'select' || type === 'ranking';
  if (!hasOptions && (options.length || other)) {
    error(options[0]?.line ?? other!.line, `Options are not allowed on a ${type} question.`);
  }
  if (type !== 'grid' && type !== 'checkbox-grid' && table.length) {
    error(table[0]!.line, `A table is only allowed on a grid question.`);
  }

  let question: Question;
  switch (type) {
    case 'text':
      question = clean({
        ...base,
        type,
        placeholder: str('placeholder'),
        minLength: num('minlength', true),
        maxLength: num('maxlength', true),
        pattern: str('pattern'),
      });
      if (question.pattern !== undefined) {
        try {
          new RegExp(question.pattern, 'u');
        } catch {
          error(typeLine, `Invalid pattern "${question.pattern}".`);
        }
      }
      break;
    case 'paragraph':
      question = clean({
        ...base,
        type,
        placeholder: str('placeholder'),
        minLength: num('minlength', true),
        maxLength: num('maxlength', true),
      });
      break;
    case 'email':
    case 'url':
      question = clean({ ...base, type, placeholder: str('placeholder') });
      break;
    case 'number':
      question = clean({
        ...base,
        type,
        placeholder: str('placeholder'),
        min: num('min'),
        max: num('max'),
        step: num('step'),
      });
      break;
    case 'date':
    case 'time': {
      const format = type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{2}:\d{2}$/;
      const min = str('min');
      const max = str('max');
      for (const [k, v] of [['min', min], ['max', max]] as const) {
        if (v !== undefined && !format.test(v)) {
          error(typeLine, `"${k}" must be formatted as ${type === 'date' ? 'YYYY-MM-DD' : 'HH:MM'}.`);
        }
      }
      question = clean({ ...base, type, min, max });
      break;
    }
    case 'radio':
    case 'checkbox':
    case 'select': {
      if (!options.length) error(typeLine, `A ${type} question needs at least one option.`);
      const expected: Marker = type === 'checkbox' ? 'checkbox' : 'radio';
      for (const o of options) {
        if (o.marker === 'numbered') {
          warn(o.line, `Numbered options are for rankings. Use ${expected === 'radio' ? '( )' : '[ ]'} for options of a ${type} question.`);
        } else if (o.marker !== 'plain' && o.marker !== expected) {
          warn(o.line, `Use ${expected === 'radio' ? '( )' : '[ ]'} for options of a ${type} question.`);
        }
        if (o.goto && type === 'checkbox') {
          warn(o.line, 'Jumps only work on single-choice questions.');
        } else if (o.goto) {
          const option = o.option;
          gotos.push({
            target: o.goto.target,
            line: o.line,
            column: o.goto.column,
            fromPage: pageIdx,
            apply: (id) => (option.goto = id),
          });
        }
      }
      if (type !== 'checkbox' && options.filter((o) => o.option.default).length > 1) {
        warn(lineNo, 'Only one option can be selected by default.');
      }
      if (type === 'select' && other) {
        error(other.line, 'A select question cannot have an "other" option.');
      }
      const opts = options.map((o) => o.option);
      if (type === 'checkbox') {
        question = clean({
          ...base,
          type,
          options: opts,
          other: other?.label,
          shuffle: flag('shuffle'),
          minSelected: num('min', true),
          maxSelected: num('max', true),
        });
      } else if (type === 'radio') {
        question = clean({ ...base, type, options: opts, other: other?.label, shuffle: flag('shuffle') });
      } else {
        question = clean({ ...base, type, options: opts, shuffle: flag('shuffle') });
      }
      break;
    }
    case 'ranking': {
      if (options.length < 2) error(typeLine, 'A ranking needs at least two options.');
      for (const o of options) {
        if (o.marker === 'radio' || o.marker === 'checkbox') {
          warn(o.line, 'Use numbered options (1. 2. 3.) or - for a ranking.');
        } else if (o.goto) {
          warn(o.line, 'Jumps only work on single-choice questions.');
        }
      }
      if (other) error(other.line, 'A ranking cannot have an "other" option.');
      question = clean({
        ...base,
        type,
        // Keep label/value/flags, drop default/goto which don't apply to rankings.
        options: options.map((o) => clean({ label: o.option.label, value: o.option.value, flags: o.option.flags })),
        shuffle: flag('shuffle'),
      });
      break;
    }
    case 'scale': {
      let min = num('min', true) ?? 1;
      let max = num('max', true) ?? 5;
      const range = args.positional.find((p) => /^-?\d+\.\.-?\d+$/.test(p.value) && !p.quoted);
      if (range) {
        [min, max] = range.value.split('..').map(Number) as [number, number];
      }
      const labels = args.positional.filter((p) => p !== range);
      if (min >= max) error(typeLine, 'The scale minimum must be less than the maximum.');
      if (max - min > 10) error(typeLine, 'A scale can have at most 11 steps.');
      question = clean({
        ...base,
        type,
        min,
        max,
        minLabel: str('minlabel') ?? labels[0]?.value,
        maxLabel: str('maxlabel') ?? labels[1]?.value,
      });
      if (labels.length > 2) error(typeLine, 'A scale takes at most two labels.');
      break;
    }
    case 'rating': {
      let max = num('max', true) ?? 5;
      const pos = args.positional[0];
      if (pos) {
        const n = Number(pos.value);
        if (Number.isInteger(n)) max = n;
        else error(typeLine, 'The rating maximum must be a whole number.');
      }
      if (max < 2 || max > 10) error(typeLine, 'The rating maximum must be between 2 and 10.');
      question = { ...base, type, max };
      break;
    }
    case 'grid':
    case 'checkbox-grid': {
      const [head, ...body] = table;
      const columns = head
        ? head.cells.slice(1).map((c) => parseChoiceLabel(c, head.line, warn)).filter((c) => c.label)
        : [];
      const rows = body
        .map((r) => parseChoiceLabel(r.cells[0] ?? '', r.line, warn))
        .filter((c) => c.label);
      if (!head) {
        error(typeLine, 'A grid needs a table. The header row lists the columns, the first cell of each row is the row label.');
      } else if (!columns.length) {
        error(head.line, 'The grid header row needs at least one column.');
      }
      if (head && !rows.length) error(head.line, 'A grid needs at least one row.');
      question = { ...base, type, rows, columns };
      break;
    }
    case 'file': {
      const accept = str('accept');
      const maxSize = str('maxsize');
      let bytes: number | undefined;
      if (maxSize !== undefined) {
        bytes = parseSize(maxSize);
        if (bytes === undefined) error(typeLine, `Invalid size "${maxSize}". Use for example 10MB.`);
      }
      question = clean({
        ...base,
        type,
        accept: accept
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        maxSize: bytes,
        maxFiles: num('maxfiles', true),
      });
      break;
    }
    case 'phone': {
      const country = str('country')?.toUpperCase();
      if (country !== undefined && phoneCode(country) === undefined) {
        error(typeLine, `Unknown country "${country}". Use a two-letter code, such as NL or US.`);
      }
      question = clean({ ...base, type, placeholder: str('placeholder'), country });
      break;
    }
    case 'address': {
      const country = str('country')?.toUpperCase();
      if (country !== undefined && !isCountryCode(country)) {
        error(typeLine, `Unknown country "${country}". Use a two-letter code, such as NL or US.`);
      }
      question = clean({ ...base, type, country });
      break;
    }
  }

  if (typeSpec) {
    for (const key of Object.keys(args.named)) {
      if (!known.has(key)) warn(typeLine, `Unknown attribute "${key}" for ${type}.`);
    }
    for (const f of args.flags) {
      if (!known.has(f)) warn(typeLine, `Unknown attribute "${f}" for ${type}.`);
    }
    if (type !== 'scale' && type !== 'rating' && args.positional.length) {
      warn(typeLine, `Unexpected value "${args.positional[0]!.value}".`);
    }
  }

  return { question: withRequired(question), explicitId, line: lineNo };
}

interface Args {
  named: Record<string, string>;
  flags: Set<string>;
  positional: { value: string; quoted: boolean }[];
}

/** Parses `key=value key="quoted value" flag "positional" 1..5` */
export function parseArgs(input: string, line: number, error: Report): Args {
  const args: Args = { named: {}, flags: new Set(), positional: [] };
  const re = /\s*(?:([A-Za-z][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|(\S*))|"((?:[^"\\]|\\.)*)"|(\S+))/gy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < input.length && (m = re.exec(input))) {
    pos = re.lastIndex;
    const [, key, quotedValue, bareValue, quoted, bare] = m;
    if (key !== undefined) {
      args.named[key.toLowerCase()] = quotedValue !== undefined ? unescapeQuoted(quotedValue) : bareValue!;
    } else if (quoted !== undefined) {
      args.positional.push({ value: unescapeQuoted(quoted), quoted: true });
    } else if (bare !== undefined) {
      if (bare.startsWith('"')) {
        error(line, 'Unclosed quote.');
        break;
      }
      if (/^[A-Za-z][\w-]*$/.test(bare)) args.flags.add(bare.toLowerCase());
      else args.positional.push({ value: bare, quoted: false });
    }
  }
  return args;
}

function unescapeQuoted(s: string): string {
  return s.replace(/\\(["\\])/g, '$1');
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

export function parseSize(input: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*([kmg]?b)?$/i.exec(input.trim());
  if (!m) return undefined;
  return Math.round(Number(m[1]) * SIZE_UNITS[(m[2] ?? 'b').toLowerCase()]!);
}

export function formatSize(bytes: number): string {
  for (const unit of ['GB', 'MB', 'KB'] as const) {
    const size = SIZE_UNITS[unit.toLowerCase()]!;
    if (bytes >= size && bytes % size === 0) return `${bytes / size}${unit}`;
  }
  return `${bytes}B`;
}
