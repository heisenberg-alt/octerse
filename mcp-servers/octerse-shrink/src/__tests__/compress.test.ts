import { describe, it, expect } from 'vitest';
import {
  compressDescription,
  compressListPayload,
} from '../compress.js';

describe('compressDescription — rule 1: backtick preservation', () => {
  it('keeps inline `code` spans byte-for-byte', () => {
    const r = compressDescription('Use this tool to call `tools/list` very often.');
    expect(r.compressed).toContain('`tools/list`');
  });

  it('keeps multiple backtick spans', () => {
    const r = compressDescription(
      'This tool helps you read `path/to/file.ts` and `package.json` files.',
    );
    expect(r.compressed).toContain('`path/to/file.ts`');
    expect(r.compressed).toContain('`package.json`');
  });

  it('preserves backtick content when it overlaps a fluff phrase', () => {
    // "in order to" inside a backtick MUST not be collapsed.
    const r = compressDescription(
      'Run the `build in order to` script to ship.',
    );
    expect(r.compressed).toContain('`build in order to`');
  });
});

describe('compressDescription — rule 2: filler prefix removal', () => {
  const cases: Array<[string, RegExp]> = [
    ['This tool is used to delete a file.', /^Delete a file/i],
    ['This tool allows you to delete files.', /^Delete files/i],
    ['Use this tool to delete a file.', /^Delete a file/i],
    ['Use this tool when you need to delete a file.', /you need to delete/i],
    [
      'The purpose of this tool is to delete a file.',
      /^Delete a file/i,
    ],
    ['This is a tool that deletes a file.', /^Deletes a file/i],
  ];

  for (const [input, expected] of cases) {
    it(`strips: "${input.slice(0, 40)}…"`, () => {
      const r = compressDescription(input);
      expect(r.compressed).toMatch(expected);
      expect(r.bytesOut).toBeLessThan(r.bytesIn);
    });
  }

  it('does not strip when prefix is mid-sentence', () => {
    const r = compressDescription(
      'When invoked from a script, this tool is fast.',
    );
    // Original word "tool" survives because the prefix anchor failed.
    expect(r.compressed).toContain('tool');
  });
});

describe('compressDescription — rule 3: adjective stacks', () => {
  it('strips intensifier adverbs', () => {
    const r = compressDescription('A very robust file deletion utility.');
    expect(r.compressed).not.toMatch(/very/i);
    expect(r.compressed).not.toMatch(/robust/i);
  });

  it('strips marketing adjectives', () => {
    const r = compressDescription(
      'A comprehensive, powerful, advanced file editor.',
    );
    expect(r.compressed).not.toMatch(/comprehensive/i);
    expect(r.compressed).not.toMatch(/powerful/i);
    expect(r.compressed).not.toMatch(/advanced/i);
  });

  it('collapses "simple and easy"', () => {
    const r = compressDescription('A simple and easy way to write files.');
    expect(r.compressed).not.toMatch(/simple and easy/i);
  });
});

describe('compressDescription — rule 4: phrase collapses', () => {
  const pairs: Array<[string, RegExp]> = [
    ['Run a script in order to build the artifact.', /\bto build\b/i],
    ['Reads files as well as folders.', /\band folders/i],
    ['Skipped due to the fact that auth failed.', /\bbecause auth failed/i],
    ['For the purpose of testing only.', /^For testing only/i],
    ['In the event that the build fails, retry.', /^If the build fails/i],
    ['Stops at this point in time.', /\bnow\.$/],
    ['Notes with regard to the file.', /\babout the file/i],
    ['In terms of speed, fast.', /^For speed/i],
    ['Will be able to fetch.', /\bcan fetch/i],
    ['Make use of the cache.', /^use the cache/i],
  ];

  for (const [input, expected] of pairs) {
    it(`collapses in: "${input.slice(0, 40)}…"`, () => {
      const r = compressDescription(input);
      expect(r.compressed).toMatch(expected);
    });
  }
});

describe('compressDescription — rule 5: whitespace', () => {
  it('collapses runs of spaces', () => {
    const r = compressDescription('Read    a    file.');
    expect(r.compressed).toBe('Read a file.');
  });

  it('removes space before punctuation', () => {
    const r = compressDescription('Read a file , then close it .');
    expect(r.compressed).toBe('Read a file, then close it.');
  });

  it('collapses blank lines', () => {
    const r = compressDescription('Line one.\n\n\nLine two.');
    expect(r.compressed).toBe('Line one.\nLine two.');
  });
});

describe('compressDescription — rule 6: hard cap', () => {
  it('respects 240-byte cap', () => {
    const long = 'word '.repeat(200);
    const r = compressDescription(long);
    expect(r.bytesOut).toBeLessThanOrEqual(240);
  });

  it('cuts on word boundary, not mid-word', () => {
    const long = 'antidisestablishmentarianism '.repeat(20);
    const r = compressDescription(long);
    expect(r.compressed).not.toMatch(/antidis$/);
    // The compressed string should end on a complete word.
    expect(r.compressed).toMatch(/\w$/);
  });

  it('respects custom hardCap', () => {
    const r = compressDescription('one two three four five six seven eight nine ten', {
      hardCap: 20,
    });
    expect(r.bytesOut).toBeLessThanOrEqual(20);
  });

  it('does not cap when input is short', () => {
    const r = compressDescription('short.');
    expect(r.compressed).toBe('short.');
  });
});

describe('compressDescription — punctuation preservation', () => {
  it('keeps trailing period when original had one', () => {
    const r = compressDescription('Use this tool to call api.');
    expect(r.compressed).toMatch(/\.$/);
  });

  it('does not invent a trailing period when original had none', () => {
    const r = compressDescription('Use this tool to call api');
    expect(r.compressed).not.toMatch(/\.$/);
  });
});

describe('compressDescription — passthrough', () => {
  it('returns original unchanged when passthrough=true', () => {
    const original = 'This tool is used to do very robust things in order to win.';
    const r = compressDescription(original, { passthrough: true });
    expect(r.compressed).toBe(original);
    expect(r.ruleHits).toHaveLength(0);
  });

  it('handles empty input', () => {
    const r = compressDescription('');
    expect(r.compressed).toBe('');
    expect(r.bytesIn).toBe(0);
    expect(r.bytesOut).toBe(0);
  });
});

describe('compressDescription — savings', () => {
  it('shrinks a typical bloated description by >=30%', () => {
    const before =
      'This tool is used to allow you to perform comprehensive and powerful filesystem operations in order to read, write, as well as delete files. Note that you should be able to use this very robust API at this point in time.';
    const r = compressDescription(before);
    const ratio = r.bytesOut / r.bytesIn;
    expect(ratio).toBeLessThan(0.7);
  });
});

describe('compressListPayload', () => {
  it('compresses every nested description field', () => {
    const input = {
      tools: [
        {
          name: 'read_file',
          description: 'This tool allows you to read very robust files.',
          inputSchema: { type: 'object' },
        },
        {
          name: 'write_file',
          description: 'Use this tool in order to write files.',
        },
      ],
    };
    const { payload, stats } = compressListPayload(input);
    const out = payload as typeof input;
    expect(out.tools[0]?.description).not.toMatch(/very robust/i);
    expect(out.tools[1]?.description).toMatch(/^Write files/i);
    expect(stats.fields).toBe(2);
    expect(stats.bytesOut).toBeLessThan(stats.bytesIn);
  });

  it('does not mutate input', () => {
    const input = {
      tools: [{ description: 'This tool is used to do things.' }],
    };
    const before = JSON.stringify(input);
    compressListPayload(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('leaves non-string description fields alone', () => {
    const input = {
      tools: [{ description: null }, { description: 42 }],
    };
    const { payload, stats } = compressListPayload(input);
    const out = payload as { tools: Array<{ description: unknown }> };
    expect(out.tools[0]?.description).toBeNull();
    expect(out.tools[1]?.description).toBe(42);
    expect(stats.fields).toBe(0);
  });

  it('preserves arbitrary keys other than description', () => {
    const input = {
      tools: [
        {
          name: 'foo',
          description: 'This tool is used to foo.',
          extraKey: { nested: 'value' },
        },
      ],
    };
    const { payload } = compressListPayload(input);
    const out = payload as typeof input;
    expect(out.tools[0]?.extraKey).toEqual({ nested: 'value' });
  });
});
