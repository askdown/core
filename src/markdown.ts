/**
 * A small, safe Markdown renderer for descriptions, help text and content
 * blocks.
 *
 * It supports a subset of CommonMark: paragraphs, headings, lists,
 * blockquotes, code, horizontal rules, emphasis, links and images. Raw HTML
 * is always escaped, and only http(s), mailto and relative URLs are allowed.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeUrl(escaped: string): string | undefined {
  // Browsers strip control characters and whitespace from URLs, so a
  // "\u0001javascript:" URL would otherwise slip past the scheme check.
  const url = unescapeHtml(escaped).replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (/^(https?:|mailto:)/i.test(url) || /^[/#?]/.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return escapeHtml(url);
  }
  return undefined;
}

export interface MarkdownOptions {
  /** Added to heading levels, so # renders as h(1 + offset). */
  headingOffset?: number;
}

/** Renders inline Markdown (no blocks) to HTML. */
export function renderInline(text: string): string {
  const slots: string[] = [];
  const hold = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;

  let s = text
    // Backslash escapes
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, (_, c: string) => hold(escapeHtml(c)))
    // Code spans
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code: string) => hold(`<code>${escapeHtml(code.trim())}</code>`));

  s = escapeHtml(s);

  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, (m, alt: string, src: string, title?: string) => {
      const url = safeUrl(src);
      if (!url) return m;
      return hold(`<img src="${url}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`);
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, (m, label: string, href: string, title?: string) => {
      const url = safeUrl(href);
      if (!url) return m;
      return `<a href="${url}"${title ? ` title="${title}"` : ''} rel="noopener noreferrer nofollow" target="_blank">${label}</a>`;
    })
    .replace(/&lt;((?:https?:\/\/|mailto:)[^\s&]+)&gt;/g, (_, url: string) =>
      hold(`<a href="${url}" rel="noopener noreferrer nofollow" target="_blank">${url}</a>`),
    )
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    // Hard line breaks
    .replace(/(?: {2,}|\\)\n/g, '<br>\n');

  return s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => slots[Number(n)]!);
}

/** Renders block Markdown to HTML. */
export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const offset = options.headingOffset ?? 0;
  let i = 0;

  const isBlank = (l: string | undefined) => l === undefined || l.trim() === '';
  const LIST = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const startsBlock = (l: string) =>
    /^\s{0,3}(#{1,6}\s|>|```|~~~|(\*\s*){3,}$|(_\s*){3,}$|(-\s*){3,}$)/.test(l) || LIST.test(l);

  while (i < lines.length) {
    const line = lines[i]!;

    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = /^\s{0,3}(```+|~~~+)\s*([\w-]*)/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) code.push(lines[i++]!);
      i++;
      const lang = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : '';
      out.push(`<pre><code${lang}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1]!.length + offset);
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s{0,3}((\*\s*){3,}|(_\s*){3,}|(-\s*){3,})$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) {
        quote.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ''));
      }
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'), options)}</blockquote>`);
      continue;
    }

    const list = LIST.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]!);
      const start = ordered ? parseInt(list[1]!, 10) : 1;
      const items: string[][] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!);
        if (m && /\d/.test(m[1]!) === ordered) {
          items.push([m[2]!]);
          i++;
        } else if (!isBlank(lines[i]) && /^\s+/.test(lines[i]!) && items.length) {
          items[items.length - 1]!.push(lines[i++]!.trim());
        } else if (!isBlank(lines[i]) && !startsBlock(lines[i]!) && items.length) {
          // Lazy continuation
          items[items.length - 1]!.push(lines[i++]!.trim());
        } else {
          break;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      const attr = ordered && start !== 1 ? ` start="${start}"` : '';
      out.push(`<${tag}${attr}>${items.map((it) => `<li>${renderInline(it.join('\n'))}</li>`).join('')}</${tag}>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]!))) {
      para.push(lines[i++]!);
    }
    out.push(`<p>${renderInline(para.map((l) => l.replace(/^\s+/, '')).join('\n'))}</p>`);
  }
  return out.join('\n');
}
