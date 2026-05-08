/**
 * Deterministic, no-LLM compression for MCP tool/prompt/resource descriptions.
 *
 * Rules applied in order:
 *   1. Preserve backtick spans verbatim (they almost always carry signal).
 *   2. Drop "This tool …", "Use this when …", "This function …" prefix sentences.
 *   3. Strip adjective stacks (very|comprehensive|powerful|robust|advanced|…).
 *   4. Phrase collapse ("in order to" → "to", "as well as" → "and", …).
 *   5. Whitespace normalisation.
 *   6. 240-char hard cap, sliced on a word boundary, no ellipsis.
 *
 * Pure functions only. No I/O. No telemetry. No randomness.
 */

const BACKTICK_PLACEHOLDER = '\u0001OCTERSE_BACKTICK_';
const BACKTICK_END = '\u0002';

const FILLER_PREFIXES = [
  /^This\s+(?:tool|function|method|command|skill)\s+(?:is\s+(?:used|designed)\s+(?:to|for)|allows\s+you\s+to|enables\s+you\s+to|lets\s+you|helps\s+you|will|can|should|may|provides|exposes|implements)\s*/i,
  /^Use\s+this\s+(?:tool|function|method|command|skill)?\s*(?:to|when|in\s+order\s+to|whenever|if)\s*/i,
  /^You\s+(?:can|should|may)\s+use\s+this\s+(?:to|when|for)?\s*/i,
  /^The\s+purpose\s+of\s+this\s+(?:tool|function|method|command|skill)\s+is\s+to\s*/i,
  /^This\s+is\s+a\s+(?:tool|function|method|utility)\s+(?:that|which|to|for)\s*/i,
];

const ADJECTIVE_STACKS = [
  /\b(?:very|extremely|highly|incredibly|really|quite|rather|truly)[\s,]+/gi,
  /\b(?:comprehensive(?:ly)?|powerful(?:ly)?|robust(?:ly)?|advanced|sophisticated|cutting[-\s]edge|state[-\s]of[-\s]the[-\s]art|seamless(?:ly)?|elegant(?:ly)?|intuitive(?:ly)?|user[-\s]friendly)[\s,]+/gi,
  /\bsimple\s+and\s+easy[\s,]+/gi,
  /\beasy\s+to\s+use[\s,]+/gi,
];

const PHRASE_COLLAPSES: Array<[RegExp, string]> = [
  [/\bin\s+order\s+to\b/gi, 'to'],
  [/\bas\s+well\s+as\b/gi, 'and'],
  [/\bas\s+a\s+matter\s+of\s+fact\b/gi, ''],
  [/\bdue\s+to\s+the\s+fact\s+that\b/gi, 'because'],
  [/\bfor\s+the\s+purpose\s+of\b/gi, 'for'],
  [/\bin\s+the\s+event\s+that\b/gi, 'if'],
  [/\bat\s+this\s+point\s+in\s+time\b/gi, 'now'],
  [/\bwith\s+regard\s+to\b/gi, 'about'],
  [/\bwith\s+respect\s+to\b/gi, 'about'],
  [/\bin\s+terms\s+of\b/gi, 'for'],
  [/\bbe\s+able\s+to\b/gi, 'can'],
  [/\bmake\s+use\s+of\b/gi, 'use'],
  [/\bperform\s+(?:the\s+)?action\s+of\b/gi, ''],
  [/\bplease\s+note\s+that\b/gi, ''],
  [/\bnote\s+that\b/gi, ''],
  [/\bplease\s+be\s+aware\s+that\b/gi, ''],
  [/\bit\s+is\s+(?:important|worth\s+noting)\s+(?:to\s+note\s+)?that\b/gi, ''],
];

const HARD_CAP = 240;

export interface CompressResult {
  original: string;
  compressed: string;
  bytesIn: number;
  bytesOut: number;
  ruleHits: string[];
}

export interface CompressOptions {
  /** Maximum byte length for the compressed output. Default 240. */
  hardCap?: number;
  /** When true, skip compression and return original unchanged (still records bytes). */
  passthrough?: boolean;
}

/**
 * Compress a single description string. Pure function.
 */
export function compressDescription(
  input: string,
  opts: CompressOptions = {},
): CompressResult {
  const original = input ?? '';
  const cap = opts.hardCap ?? HARD_CAP;

  if (opts.passthrough || !original) {
    return {
      original,
      compressed: original,
      bytesIn: byteLen(original),
      bytesOut: byteLen(original),
      ruleHits: [],
    };
  }

  // 1. Stash backtick spans
  const stash: string[] = [];
  const ruleHits: string[] = [];
  let work = original.replace(/`[^`]*`/g, (match) => {
    const i = stash.push(match) - 1;
    return `${BACKTICK_PLACEHOLDER}${i}${BACKTICK_END}`;
  });

  // 2. Drop filler prefixes
  for (const re of FILLER_PREFIXES) {
    if (re.test(work)) {
      work = work.replace(re, (m) => {
        ruleHits.push(`prefix:${m.trim().slice(0, 32)}`);
        return '';
      });
      // Capitalize first letter after prefix removal.
      work = work.replace(/^([a-z])/, (c) => c.toUpperCase());
    }
  }

  // 3. Adjective stacks
  for (const re of ADJECTIVE_STACKS) {
    work = work.replace(re, () => {
      ruleHits.push('adjective');
      return '';
    });
  }

  // 4. Phrase collapses
  for (const [re, replacement] of PHRASE_COLLAPSES) {
    work = work.replace(re, () => {
      ruleHits.push('phrase');
      return replacement;
    });
  }

  // 5. Whitespace normalisation
  work = work.replace(/[ \t]+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  work = work.replace(/\s*\n\s*\n+\s*/g, '\n').replace(/[ \t]*\n[ \t]*/g, '\n');

  // 6. Restore backtick spans
  work = work.replace(
    new RegExp(`${BACKTICK_PLACEHOLDER}(\\d+)${BACKTICK_END}`, 'g'),
    (_m, i) => stash[Number(i)] ?? '',
  );

  // 7. Hard cap on a word boundary
  if (byteLen(work) > cap) {
    work = sliceOnWordBoundary(work, cap);
    ruleHits.push('hardcap');
  }

  // Sentence-end period if it lost one and the original had one.
  if (/[.!?]$/.test(original.trim()) && !/[.!?]$/.test(work)) {
    work = work.replace(/\s*$/, '') + '.';
  }

  return {
    original,
    compressed: work,
    bytesIn: byteLen(original),
    bytesOut: byteLen(work),
    ruleHits,
  };
}

function sliceOnWordBoundary(s: string, maxBytes: number): string {
  // Slice down to <= maxBytes, then back off to nearest space/punct.
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;
  // Decode the prefix, skipping any partial trailing UTF-8 sequence.
  let cut = maxBytes;
  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut--;
  let out = dec.decode(bytes.slice(0, cut));
  // Back off to nearest whitespace if we landed mid-word.
  const lastSpace = out.search(/\s\S*$/);
  if (lastSpace > maxBytes / 2) {
    out = out.slice(0, lastSpace);
  }
  return out.trimEnd();
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Walk an MCP `tools/list` / `prompts/list` / `resources/list` payload and
 * compress every `description` it finds. Returns a new payload — does not
 * mutate input. Only compresses string descriptions; non-string values pass
 * through untouched.
 *
 * Tool-call payloads (`tools/call`) are NEVER touched by this function.
 */
export interface CompressPayloadStats {
  fields: number;
  bytesIn: number;
  bytesOut: number;
}

export function compressListPayload(
  payload: unknown,
  opts: CompressOptions = {},
): { payload: unknown; stats: CompressPayloadStats } {
  const stats: CompressPayloadStats = { fields: 0, bytesIn: 0, bytesOut: 0 };

  function visit(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(visit);
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'description' && typeof v === 'string') {
          const r = compressDescription(v, opts);
          stats.fields += 1;
          stats.bytesIn += r.bytesIn;
          stats.bytesOut += r.bytesOut;
          out[k] = r.compressed;
        } else {
          out[k] = visit(v);
        }
      }
      return out;
    }
    return node;
  }

  return { payload: visit(payload), stats };
}
