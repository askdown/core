import { slugify, uniqueId } from './ids.ts';
import { formatSize, PAGE_BREAK, QUESTION_START } from './parse.ts';
import type { Cell, Form, Item, Option, Question } from './types.ts';
import { isChoice, isQuestion } from './types.ts';

export interface SerializeOptions {
  /**
   * Write {#id} for every question and page, even when the id could be
   * derived from the label. Use this for published forms, so editing a
   * label doesn't change the id.
   */
  explicitIds?: boolean;
}

/**
 * Converts a form to canonical Askdown source text.
 *
 * `parse(serialize(form)).form` is equal to `form`.
 */
export function serialize(form: Form, options: SerializeOptions = {}): string {
  const out: string[] = [];

  const fm: [string, string | undefined][] = [
    ['title', form.title],
    ['description', form.description],
    ['submit', form.settings?.submitLabel],
    ['confirmation', form.settings?.confirmation],
  ];
  const fmLines = fm
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlString(v!)}`);
  if (fmLines.length) {
    out.push('---', ...fmLines, '---', '');
  }

  const pageIds = explicitIdSet(
    form.pages.map((p, idx) => ({ id: p.id, base: p.title ? slugify(p.title, 'page') : `page-${idx + 1}` })),
    options.explicitIds,
  );
  // Pages that are jumped to always get an explicit id, so the reference
  // is visible in the source.
  const targets = new Set(
    form.pages.flatMap((p) => [
      p.next,
      ...p.items.flatMap((item) => (isQuestion(item) && isChoice(item) ? item.options.map((o) => o.goto) : [])),
    ]),
  );
  form.pages.forEach((p, idx) => {
    if (targets.has(p.id)) pageIds.add(idx);
  });
  const questions = form.pages.flatMap((p) => p.items.filter(isQuestion));
  const questionIds = explicitIdSet(
    questions.map((q) => ({ id: q.id, base: slugify(q.label) })),
    options.explicitIds,
  );

  form.pages.forEach((page, idx) => {
    const attrs = pageIds.has(idx) ? ` {#${page.id}}` : '';
    if (idx > 0 || attrs) {
      out.push(`---${attrs}`, '');
    }
    if (page.title !== undefined) {
      out.push(`# ${oneLine(page.title)}`, '');
    }
    page.items.forEach((item, itemIdx) => {
      const explicitId = isQuestion(item) && questionIds.has(questions.indexOf(item));
      out.push(...serializeItem(item, explicitId, itemIdx === 0 && page.title === undefined), '');
    });
    if (page.next) {
      out.push(`-> ${target(page.next)}`, '');
    }
  });

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

/**
 * Works out which ids must be written explicitly, because the parser would
 * not derive them from the label (or title) on its own.
 */
function explicitIdSet(items: { id: string; base: string }[], all = false): Set<number> {
  const explicit = new Set<number>(all ? items.map((_, i) => i) : []);
  for (;;) {
    const used = new Set([...explicit].map((i) => items[i]!.id));
    let changed = false;
    items.forEach((item, i) => {
      if (explicit.has(i)) return;
      if (uniqueId(item.base, used) !== item.id) {
        explicit.add(i);
        changed = true;
      }
    });
    if (!changed) return explicit;
  }
}

function serializeItem(item: Item, explicitId: boolean, firstOnPage: boolean): string[] {
  if (item.type === 'content') {
    return escapeContent(item.markdown, firstOnPage);
  }
  const q = item;
  const lines = [`? ${oneLine(q.label)}${q.required ? ' *' : ''}${explicitId ? ` {#${q.id}}` : ''}`];
  if (q.help) {
    lines.push(...q.help.split('\n').map((l) => (l ? `> ${l}` : '>')));
  }
  lines.push(...serializeAnswer(q));
  return lines;
}

function serializeAnswer(q: Question): string[] {
  switch (q.type) {
    case 'text': {
      const a = attrs({ placeholder: q.placeholder, minlength: q.minLength, maxlength: q.maxLength, pattern: q.pattern });
      return a ? [`[text${a}]`] : ['___'];
    }
    case 'paragraph': {
      const a = attrs({ placeholder: q.placeholder, minlength: q.minLength, maxlength: q.maxLength });
      return a ? [`[paragraph${a}]`] : ['___', '___'];
    }
    case 'email':
    case 'url':
      return [`[${q.type}${attrs({ placeholder: q.placeholder })}]`];
    case 'phone':
      return [`[phone${attrs({ placeholder: q.placeholder, country: q.country })}]`];
    case 'number':
      return [`[number${attrs({ placeholder: q.placeholder, min: q.min, max: q.max, step: q.step })}]`];
    case 'date':
    case 'time':
      return [`[${q.type}${attrs({ min: q.min, max: q.max })}]`];
    case 'radio': {
      const a = attrs({ shuffle: q.shuffle });
      return [
        ...(a ? [`[radio${a}]`] : []),
        ...q.options.map((o) => option('(', ')', o)),
        ...(q.other !== undefined ? [`- ( ) ${q.other}: ___`] : []),
      ];
    }
    case 'checkbox': {
      const a = attrs({ shuffle: q.shuffle, min: q.minSelected, max: q.maxSelected });
      return [
        ...(a ? [`[checkbox${a}]`] : []),
        ...q.options.map((o) => option('[', ']', o)),
        ...(q.other !== undefined ? [`- [ ] ${q.other}: ___`] : []),
      ];
    }
    case 'select':
      return [
        `[select${attrs({ shuffle: q.shuffle })}]`,
        ...q.options.map((o) =>
          o.default
            ? option('(', ')', o)
            : `- ${o.label}${choiceAttrs(o)}${o.goto ? ` -> ${target(o.goto)}` : ''}`,
        ),
      ];
    case 'ranking':
      return [
        ...(q.shuffle ? ['[ranking shuffle]'] : []),
        ...q.options.map((o, n) => `${n + 1}. ${o.label}${choiceAttrs(o)}`),
      ];
    case 'scale': {
      let spec = `[scale ${q.min}..${q.max}`;
      if (q.minLabel !== undefined) {
        spec += ` ${quote(q.minLabel)}`;
        if (q.maxLabel !== undefined) spec += ` ${quote(q.maxLabel)}`;
      } else if (q.maxLabel !== undefined) {
        spec += ` maxlabel=${quote(q.maxLabel)}`;
      }
      return [`${spec}]`];
    }
    case 'rating':
      return [`[rating ${q.max}]`];
    case 'grid':
    case 'checkbox-grid':
      return [
        `[${q.type}]`,
        `| ${['', ...q.columns.map(gridCell)].join(' | ')} |`.replace(/^\|  \|/, '|    |'),
        ...q.rows.map((r) => `| ${gridCell(r)} |`),
      ];
    case 'address':
      return [`[address${attrs({ country: q.country })}]`];
    case 'file':
      return [
        `[file${attrs({
          accept: q.accept?.join(','),
          maxsize: q.maxSize !== undefined ? formatSize(q.maxSize) : undefined,
          maxfiles: q.maxFiles,
        })}]`,
      ];
  }
}

function option(open: string, close: string, o: Option): string {
  const marker = `${open}${o.default ? 'x' : ' '}${close}`;
  return `- ${marker} ${o.label}${choiceAttrs(o)}${o.goto ? ` -> ${target(o.goto)}` : ''}`;
}

/** ` {value .flag}` for an option or cell, or "" when it has neither. */
function choiceAttrs(c: { value?: string; flags?: string[] }): string {
  const parts: string[] = [];
  if (c.value !== undefined) parts.push(c.value);
  if (c.flags) for (const f of c.flags) parts.push(`.${f}`);
  return parts.length ? ` {${parts.join(' ')}}` : '';
}

function gridCell(c: Cell): string {
  return `${c.label.replace(/\|/g, '/')}${choiceAttrs(c)}`;
}

function target(id: string): string {
  return id === 'submit' ? 'submit' : `#${id}`;
}

function attrs(values: Record<string, string | number | boolean | undefined>): string {
  let s = '';
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === false) continue;
    if (v === true) s += ` ${k}`;
    else if (typeof v === 'number') s += ` ${k}=${v}`;
    else s += ` ${k}=${/^[^\s"\]\\]+$/.test(v) ? v : quote(v)}`;
  }
  return s;
}

function quote(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`;
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ');
}

/**
 * Escapes Markdown lines that would otherwise be read as Askdown syntax.
 */
function escapeContent(markdown: string, firstOnPage: boolean): string[] {
  let inFence = false;
  return markdown.split('\n').map((line, idx) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    if (QUESTION_START.test(line) || /^->\s*\S+\s*$/.test(line)) return `\\${line}`;
    // An hr is a page break in Askdown; *** is an equivalent hr.
    if (PAGE_BREAK.test(line)) return '***';
    // A level 1 heading at the start of a page would become the page title.
    if (idx === 0 && firstOnPage && /^#\s/.test(line)) return `\\${line}`;
    return line;
  });
}

const YAML_RESERVED = /^(true|false|null|yes|no|on|off|~|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)(e[-+]?\d+)?)$/i;

function yamlString(value: string): string {
  if (value.includes('\n')) {
    return `|\n${value
      .split('\n')
      .map((l) => (l ? `  ${l}` : ''))
      .join('\n')}`;
  }
  if (
    value === '' ||
    value !== value.trim() ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /: | #/.test(value) ||
    YAML_RESERVED.test(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}
