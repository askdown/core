import { describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown } from '../src/index.ts';

describe('renderInline', () => {
  it.each([
    ['**bold** and *em* and _em_ and ~~del~~', '<strong>bold</strong> and <em>em</em> and <em>em</em> and <del>del</del>'],
    ['`<code> *x*`', '<code>&lt;code&gt; *x*</code>'],
    ['snake_case_word', 'snake_case_word'],
    ['\\*not em\\*', '*not em*'],
    ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
    ['[x](javascript:alert(1))', '[x](javascript:alert(1))'],
    ['[x](JaVaScRiPt:alert(1))', '[x](JaVaScRiPt:alert(1))'],
    ['[x](data:text/html,hi)', '[x](data:text/html,hi)'],
    ['[x](\u0001javascript:alert(1))', '[x](\u0001javascript:alert(1))'],
    ['[x](java\tscript:alert(1))', '[x](java\tscript:alert(1))'],
    [
      '[a "b"](https://x.dev/?a=1&b=2 "T")',
      '<a href="https://x.dev/?a=1&amp;b=2" title="T" rel="noopener noreferrer nofollow" target="_blank">a &quot;b&quot;</a>',
    ],
    ['[rel](/spec#x)', '<a href="/spec#x" rel="noopener noreferrer nofollow" target="_blank">rel</a>'],
    ['![alt](https://x.dev/a.png)', '<img src="https://x.dev/a.png" alt="alt" loading="lazy">'],
    ['<https://x.dev>', '<a href="https://x.dev" rel="noopener noreferrer nofollow" target="_blank">https://x.dev</a>'],
    ['[a"onmouseover="x](https://x.dev)', '<a href="https://x.dev" rel="noopener noreferrer nofollow" target="_blank">a&quot;onmouseover=&quot;x</a>'],
  ])('%j', (input, expected) => {
    expect(renderInline(input)).toBe(expected);
  });
});

describe('renderMarkdown', () => {
  it('renders blocks', () => {
    expect(
      renderMarkdown(
        ['# Title', '', 'Para one', 'continues', '', '- a', '- b', '', '3. c', '4. d', '', '> quote', '', '```js', '<b>', '```', '', '***'].join('\n'),
      ),
    ).toBe(
      [
        '<h1>Title</h1>',
        '<p>Para one\ncontinues</p>',
        '<ul><li>a</li><li>b</li></ul>',
        '<ol start="3"><li>c</li><li>d</li></ol>',
        '<blockquote><p>quote</p></blockquote>',
        '<pre><code class="language-js">&lt;b&gt;</code></pre>',
        '<hr>',
      ].join('\n'),
    );
  });

  it('offsets headings', () => {
    expect(renderMarkdown('# A\n###### B', { headingOffset: 1 })).toBe('<h2>A</h2>\n<h6>B</h6>');
  });

  it('ignores unsafe code fence info strings', () => {
    expect(renderMarkdown('```"><x\ncode\n```')).toBe('<pre><code>code</code></pre>');
  });
});
