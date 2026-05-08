import { describe, expect, it } from 'vitest';
import { compressMarkdown } from '../markdown.js';

describe('compressMarkdown', () => {
  it('idempotency: marker prevents re-compression', () => {
    const input = '# Hello\n\nThis tool is a very comprehensive helper.\n';
    const first = compressMarkdown(input);
    expect(first.changed).toBe(true);
    expect(first.body.startsWith('<!-- octerse-compressed: true -->\n')).toBe(true);

    const second = compressMarkdown(first.body);
    expect(second.changed).toBe(false);
    expect(second.refusal).toBe('already-compressed');
    expect(second.body).toBe(first.body);
  });

  it('--force re-compresses without stacking markers', () => {
    const input = '# Hello\n\nThis tool helps you debug.\n';
    const first = compressMarkdown(input);
    const forced = compressMarkdown(first.body, { force: true });
    const markerCount = (forced.body.match(/octerse-compressed: true/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('preserves fenced code blocks verbatim', () => {
    const code = '```python\ndef hello(): \n    return "this tool is very comprehensive"\nprint(  hello())\n```';
    const input = `Some prose here. This tool is a very comprehensive helper.\n\n${code}\n`;
    const r = compressMarkdown(input);
    expect(r.body).toContain(code);
  });

  it('preserves tilde fences', () => {
    const code = '~~~js\n  const x = "preserve  spaces";\n~~~';
    const input = `Intro prose with very comprehensive description.\n\n${code}\n`;
    const r = compressMarkdown(input);
    expect(r.body).toContain(code);
  });

  it('preserves inline backticks', () => {
    const input = 'Run `npm  install` very carefully please now.\n';
    const r = compressMarkdown(input);
    expect(r.body).toContain('`npm  install`');
  });

  it('preserves markdown links', () => {
    const input = 'See [the docs page](https://example.com/docs) for very comprehensive details.\n';
    const r = compressMarkdown(input);
    expect(r.body).toContain('[the docs page](https://example.com/docs)');
  });

  it('preserves @file/path:line references', () => {
    const input = 'The bug is in @src/foo.ts:42 — please be very thorough about it.\n';
    const r = compressMarkdown(input);
    expect(r.body).toContain('@src/foo.ts:42');
  });

  it('keeps heading prefixes intact', () => {
    const input = '## This Tool is Very Comprehensive\n\nbody\n';
    const r = compressMarkdown(input);
    expect(r.body).toMatch(/^<!-- octerse-compressed: true -->\n## /m);
    expect(r.bytesOut).toBeLessThan(r.bytesIn + 50); // marker added but body shrunk
  });

  it('keeps list bullets intact', () => {
    const input = '- This tool is very comprehensive\n- Another bullet\n  - nested very robust item\n';
    const r = compressMarkdown(input);
    expect(r.body).toMatch(/^- /m);
    expect(r.body).toMatch(/^  - /m); // indented bullet preserved
  });

  it('keeps numbered list bullets intact', () => {
    const input = '1. First item, very comprehensive description here.\n2. Second item.\n';
    const r = compressMarkdown(input);
    expect(r.body).toMatch(/^1\. /m);
    expect(r.body).toMatch(/^2\. /m);
  });

  it('honours <!-- octerse:keep --> ... <!-- octerse:end --> spans', () => {
    const input = `# Doc

Some prose that is very comprehensive and will be shrunk.

<!-- octerse:keep -->
KEEP THIS    EXACTLY    AS-IS    very comprehensive
trailing whitespace too.    
<!-- octerse:end -->

Another very comprehensive paragraph after the span.
`;
    const r = compressMarkdown(input);
    expect(r.body).toContain('KEEP THIS    EXACTLY    AS-IS    very comprehensive');
    expect(r.body).toContain('trailing whitespace too.    ');
  });

  it('refuses when keep span covers entire file', () => {
    const input = '<!-- octerse:keep -->\nentire body\nis kept\n<!-- octerse:end -->\n';
    const r = compressMarkdown(input);
    expect(r.refusal).toBe('keep-span-covers-all');
    expect(r.body).toBe(input);
  });

  it('shrinks plain prose substantially', () => {
    // Long enough that the marker overhead doesn't dominate.
    const input = [
      'This tool is a very comprehensive and powerful utility.',
      'In order to use it, please simply invoke the script.',
      'It is very robust and very thorough at handling edge cases.',
      'Additionally, you should note that the tool is very fast.',
      'For your convenience, we have made it very easy to install.',
    ].join(' ') + '\n';
    const r = compressMarkdown(input);
    expect(r.bytesOut).toBeLessThan(r.bytesIn);
  });

  it('preserves blockquote prefix', () => {
    const input = '> This tool is very comprehensive.\n> Another quoted line.\n';
    const r = compressMarkdown(input);
    expect(r.body).toMatch(/^> /m);
  });

  it('collapses 3+ blank lines to 2', () => {
    const input = 'a\n\n\n\n\nb\n';
    const r = compressMarkdown(input);
    expect(r.body).not.toMatch(/\n\n\n\n/);
  });

  it('preserves horizontal rules', () => {
    const input = 'before\n\n---\n\nafter very comprehensive\n';
    const r = compressMarkdown(input);
    expect(r.body).toMatch(/^---$/m);
  });

  it('round-trip: structure is byte-identical for already-terse markdown', () => {
    const input = `<!-- octerse-compressed: true -->
# Title

- a
- b

\`\`\`js
const x = 1;
\`\`\`
`;
    const r = compressMarkdown(input);
    expect(r.refusal).toBe('already-compressed');
    expect(r.body).toBe(input);
  });
});
