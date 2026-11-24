import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Directory of the installed @askdown/spec package: the spec, schema and examples. */
const SPEC_DIR = dirname(createRequire(import.meta.url).resolve('@askdown/spec/package.json'));

/** Path of a file (or, with a trailing slash, a directory) in @askdown/spec. */
export const specPath = (path: string): string => join(SPEC_DIR, path);
