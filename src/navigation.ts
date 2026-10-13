import { type Answers, type Form, isQuestion, SUBMIT } from './types.ts';

/**
 * Returns the index of the page after `pageIndex`, or `null` when the form
 * should be submitted.
 *
 * The last single-choice question on the page with a jump on the chosen
 * option decides. Otherwise the page's `next` applies, and otherwise the
 * following page.
 */
export function nextPage(form: Form, pageIndex: number, answers: Answers): number | null {
  const page = form.pages[pageIndex];
  if (!page) return null;

  let target: string | undefined;
  for (const item of page.items) {
    if (!isQuestion(item) || (item.type !== 'radio' && item.type !== 'select')) continue;
    const answer = answers[item.id];
    const option = item.options.find((o) => o.label === answer);
    if (option?.goto) target = option.goto;
  }
  target ??= page.next;

  if (target === SUBMIT) return null;
  if (target !== undefined) {
    const idx = form.pages.findIndex((p) => p.id === target);
    if (idx !== -1) return idx;
  }
  return pageIndex + 1 < form.pages.length ? pageIndex + 1 : null;
}

/**
 * Returns the indexes of the pages a respondent visits with these answers,
 * in order. Stops when a page would be visited twice.
 */
export function visitedPages(form: Form, answers: Answers): number[] {
  const visited: number[] = [];
  const seen = new Set<number>();
  let current: number | null = form.pages.length ? 0 : null;
  while (current !== null && !seen.has(current)) {
    visited.push(current);
    seen.add(current);
    current = nextPage(form, current, answers);
  }
  return visited;
}
