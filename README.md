# @askdown/core

Parser, serializer and validator for [Askdown](https://askdown.dev), a Markdown-like language for forms.

```sh
npm install @askdown/core
```

```js
import { parse, serialize, validateResponse } from '@askdown/core';

const { form, diagnostics } = parse(`
? Name *
___

? Will you attend?
- ( ) Yes
- ( ) No
`);

serialize(form); // canonical Askdown text

validateResponse(form, { name: 'Ada', 'will-you-attend': 'Yes' });
// { valid: true, errors: [], answers: { ... }, pages: [0] }
```

Zero dependencies. Runs in browsers, Node.js, Deno, Bun and Cloudflare Workers.

## API

| Function | |
|---|---|
| `parse(source)` | Parse Askdown text into `{ form, diagnostics, locations }`. Never throws. |
| `serialize(form, { explicitIds? })` | Convert a form to canonical Askdown text. |
| `pinIds(source)` | Add `{#id}` to every question and page without one, changing only those lines. |
| `validateForm(form)` | Check rules the JSON Schema can't express (unique ids, jump targets…). |
| `validateResponse(form, answers)` | Validate and normalize a response, following jumps. |
| `checkAnswer(question, value)` | Validate a single answer. |
| `nextPage(form, pageIndex, answers)`, `visitedPages(form, answers)` | Branching logic. |
| `renderMarkdown(md)`, `renderInline(md)` | The safe Markdown subset used in forms. |

The JSON form model is described by the [JSON Schema](https://askdown.dev/schema/v0.1.json) and the [spec](https://askdown.dev/spec).
