/**
 * Turns a label into an id: lowercase ASCII letters, digits and dashes.
 */
export function slugify(label: string, fallback = 'q'): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || fallback;
}

/**
 * Returns `base`, or `base-2`, `base-3`... whichever is not in `used`.
 * Adds the result to `used`.
 */
export function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let i = 2; used.has(id); i++) {
    id = `${base}-${i}`;
  }
  used.add(id);
  return id;
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
