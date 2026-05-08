/**
 * Markdown-aware compression for AGENTS.md / instructions files.
 *
 * Reuses the prose pipeline from compress.ts but is structure-preserving:
 *
 *   1. Fenced code blocks (``` ... ```)            — preserved verbatim
 *   2. Inline backticks (`foo`)                    — preserved verbatim
 *   3. Markdown links [text](url)                  — preserved verbatim
 *   4. @file/path:line refs                        — preserved verbatim
 *   5. Headings (#, ##, ###)                       — kept, only their text trimmed
 *   6. List bullets (-, *, +, 1.) + indentation    — kept exactly
 *   7. <!-- octerse:keep --> ... <!-- octerse:end -->   — pass-through
 *   8. Anything else (prose runs)                  — fed through compressDescription
 *
 * Idempotent: writes a single `<!-- octerse-compressed: true -->` marker on the
 * first line of the output; if input already starts with that marker, returns
 * input unchanged unless `force: true`.
 *
 * Refusal: if a single keep-span covers the entire body, returns
 * { body: input, refusal: 'keep-span-covers-all' } — the caller decides whether
 * to error.
 */

import { compressDescription } from './compress.js';

export interface MarkdownCompressOptions {
  force?: boolean;
}

export interface MarkdownCompressResult {
  body: string;
  bytesIn: number;
  bytesOut: number;
  changed: boolean;
  refusal?: 'already-compressed' | 'keep-span-covers-all';
}

const MARKER = '<!-- octerse-compressed: true -->';
const KEEP_OPEN = /<!--\s*octerse:keep\s*-->/i;
const KEEP_CLOSE = /<!--\s*octerse:end\s*-->/i;
const FENCE = /^(\s{0,3})(```+|~~~+)(.*)$/;
const HEADING = /^(\s{0,3}#{1,6}\s+)(.*?)(\s*#*\s*)$/;
const BULLET = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const BLOCKQUOTE = /^(\s*>+\s*)(.*)$/;
const HORIZONTAL_RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

interface PreservedSegment {
  placeholder: string;
  original: string;
}

/** Collect [text](url) and @file/path:line refs and stash them. */
function stashInline(text: string, segments: PreservedSegment[]): string {
  let out = text;

  // Stash markdown links FIRST — their `text` may contain backticks.
  out = out.replace(/\[[^\]]*\]\([^)]+\)/g, (match) => {
    const placeholder = `\u0001L${segments.length}\u0001`;
    segments.push({ placeholder, original: match });
    return placeholder;
  });

  // Stash @file/path:line — keep paths intact (developers grep these).
  out = out.replace(/@[\w./-]+(?::\d+(?:-\d+)?)?/g, (match) => {
    if (!match.includes('/') && !match.includes(':')) return match;
    const placeholder = `\u0001F${segments.length}\u0001`;
    segments.push({ placeholder, original: match });
    return placeholder;
  });

  // Inline `code` is already preserved by compressDescription's backtick stash,
  // so we don't double-stash here.

  return out;
}

function unstashInline(text: string, segments: PreservedSegment[]): string {
  let out = text;
  for (const seg of segments) {
    out = out.split(seg.placeholder).join(seg.original);
  }
  return out;
}

function compressProseLine(line: string): string {
  const segments: PreservedSegment[] = [];
  const stashed = stashInline(line, segments);
  // Use compressDescription with a generous cap — markdown lines are bounded
  // by readability, not the MCP 240-byte rule.
  const r = compressDescription(stashed, { hardCap: 4096 });
  return unstashInline(r.compressed, segments);
}

/** True if line ends an open fenced code block opened with `marker`. */
function isFenceClose(line: string, marker: string): boolean {
  const m = FENCE.exec(line);
  if (!m) return false;
  const found = m[2]!;
  // Closing fence must use same char and be ≥ same length, with no extra info string.
  return found.startsWith(marker[0]!) && found.length >= marker.length && (m[3] ?? '').trim() === '';
}

export function compressMarkdown(
  input: string,
  opts: MarkdownCompressOptions = {},
): MarkdownCompressResult {
  const bytesIn = Buffer.byteLength(input, 'utf8');

  if (input.trimStart().startsWith(MARKER) && !opts.force) {
    return { body: input, bytesIn, bytesOut: bytesIn, changed: false, refusal: 'already-compressed' };
  }

  // Strip an existing marker so we don't accumulate them on --force.
  let working = input;
  if (working.trimStart().startsWith(MARKER)) {
    const idx = working.indexOf(MARKER);
    working = working.slice(0, idx) + working.slice(idx + MARKER.length).replace(/^\n/, '');
  }

  const lines = working.split('\n');
  const out: string[] = [];

  let inFence = false;
  let fenceMarker = '';
  let inKeep = false;
  let keepCovers = true;     // becomes false the moment we see a non-keep, non-blank line
  let sawAnyContent = false;

  for (const raw of lines) {
    if (raw.length > 0) sawAnyContent = true;

    if (inFence) {
      out.push(raw);
      if (isFenceClose(raw, fenceMarker)) {
        inFence = false;
        fenceMarker = '';
      }
      keepCovers = false;
      continue;
    }

    if (inKeep) {
      out.push(raw);
      if (KEEP_CLOSE.test(raw)) inKeep = false;
      continue;
    }
    if (KEEP_OPEN.test(raw)) {
      inKeep = true;
      out.push(raw);
      continue;
    }

    // Outside any preserved region. Blank lines don't disprove keep-covers.
    if (raw.trim() !== '') keepCovers = false;

    // Fence open?
    const fm = FENCE.exec(raw);
    if (fm) {
      out.push(raw);
      inFence = true;
      fenceMarker = fm[2]!;
      continue;
    }

    if (HORIZONTAL_RULE.test(raw)) { out.push(raw); continue; }
    if (raw.trim() === '') { out.push(''); continue; }

    const heading = HEADING.exec(raw);
    if (heading) {
      const compressed = compressProseLine(heading[2]!);
      out.push(`${heading[1]}${compressed}${heading[3] ?? ''}`);
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet) {
      const compressed = compressProseLine(bullet[3]!);
      out.push(`${bullet[1]}${bullet[2]} ${compressed}`);
      continue;
    }

    const bq = BLOCKQUOTE.exec(raw);
    if (bq) {
      const compressed = compressProseLine(bq[2]!);
      out.push(`${bq[1]}${compressed}`);
      continue;
    }

    out.push(compressProseLine(raw));
  }

  if (sawAnyContent && keepCovers) {
    return { body: input, bytesIn, bytesOut: bytesIn, changed: false, refusal: 'keep-span-covers-all' };
  }

  // Collapse runs of 3+ blank lines down to 2.
  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of out) {
    const safe = line ?? '';
    if (safe.trim() === '') {
      blankRun++;
      if (blankRun <= 2) collapsed.push(safe);
    } else {
      blankRun = 0;
      collapsed.push(safe);
    }
  }

  const body = `${MARKER}\n${collapsed.join('\n').replace(/^\n+/, '')}`;
  const bytesOut = Buffer.byteLength(body, 'utf8');
  return { body, bytesIn, bytesOut, changed: body !== input };
}
