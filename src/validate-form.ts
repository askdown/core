import { isCountryCode } from './countries.ts';
import { ID_PATTERN } from './ids.ts';
import { choiceValue, type Form, isQuestion, QUESTION_TYPES, SUBMIT } from './types.ts';

export interface FormProblem {
  /** JSON Pointer to the offending value */
  path: string;
  message: string;
}

/**
 * Checks the rules of a form that the JSON Schema can't express, such as
 * unique ids and jump targets that exist.
 *
 * Assumes the form is structurally valid according to the schema.
 */
export function validateForm(form: Form): FormProblem[] {
  const problems: FormProblem[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });

  if (!form.pages.length) problem('/pages', 'A form needs at least one page.');

  const pageIds = new Set<string>();
  form.pages.forEach((page, p) => {
    if (!ID_PATTERN.test(page.id)) problem(`/pages/${p}/id`, `Invalid page id "${page.id}".`);
    if (pageIds.has(page.id)) problem(`/pages/${p}/id`, `Duplicate page id "${page.id}".`);
    pageIds.add(page.id);
  });

  const checkTarget = (path: string, target: string | undefined) => {
    if (target !== undefined && target !== SUBMIT && !pageIds.has(target)) {
      problem(path, `There is no page with id "${target}".`);
    }
  };

  const questionIds = new Set<string>();
  form.pages.forEach((page, p) => {
    checkTarget(`/pages/${p}/next`, page.next);
    page.items.forEach((item, i) => {
      if (!isQuestion(item)) return;
      const path = `/pages/${p}/items/${i}`;
      const q = item;
      if (!(QUESTION_TYPES as readonly string[]).includes(q.type)) {
        problem(`${path}/type`, `Unknown question type "${(q as { type: string }).type}".`);
        return;
      }
      if (!ID_PATTERN.test(q.id)) problem(`${path}/id`, `Invalid question id "${q.id}".`);
      if (questionIds.has(q.id)) problem(`${path}/id`, `Duplicate question id "${q.id}".`);
      questionIds.add(q.id);
      if (!q.label.trim()) problem(`${path}/label`, 'Question has no label.');

      switch (q.type) {
        case 'radio':
        case 'checkbox':
        case 'select': {
          if (!q.options.length) problem(`${path}/options`, 'Needs at least one option.');
          const values = new Set<string>();
          q.options.forEach((o, n) => {
            const v = choiceValue(o);
            if (values.has(v)) problem(`${path}/options/${n}/label`, `Duplicate option "${v}".`);
            values.add(v);
            if (o.goto !== undefined && q.type === 'checkbox') {
              problem(`${path}/options/${n}/goto`, 'Jumps only work on single-choice questions.');
            }
            checkTarget(`${path}/options/${n}/goto`, o.goto);
          });
          break;
        }
        case 'ranking': {
          if (q.options.length < 2) problem(`${path}/options`, 'Needs at least two options.');
          const values = new Set<string>();
          q.options.forEach((o, n) => {
            const v = choiceValue(o);
            if (values.has(v)) problem(`${path}/options/${n}/label`, `Duplicate option "${v}".`);
            values.add(v);
          });
          break;
        }
        case 'text':
          if (q.pattern !== undefined) {
            try {
              new RegExp(q.pattern, 'u');
            } catch {
              problem(`${path}/pattern`, 'Invalid regular expression.');
            }
          }
          break;
        case 'scale':
          if (q.min >= q.max) problem(`${path}/max`, 'The maximum must be greater than the minimum.');
          if (q.max - q.min > 10) problem(`${path}/max`, 'A scale can have at most 11 steps.');
          break;
        case 'grid':
        case 'checkbox-grid':
          if (!q.rows.length) problem(`${path}/rows`, 'Needs at least one row.');
          if (!q.columns.length) problem(`${path}/columns`, 'Needs at least one column.');
          {
            const rowValues = q.rows.map(choiceValue);
            const colValues = q.columns.map(choiceValue);
            if (new Set(rowValues).size !== rowValues.length) problem(`${path}/rows`, 'Rows must be unique.');
            if (new Set(colValues).size !== colValues.length) problem(`${path}/columns`, 'Columns must be unique.');
          }
          break;
        case 'phone':
        case 'address':
          if (q.country !== undefined && !isCountryCode(q.country)) {
            problem(`${path}/country`, `Unknown country "${q.country}".`);
          }
          break;
      }
    });
  });
  return problems;
}
