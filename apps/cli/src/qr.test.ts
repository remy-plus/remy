// The QR encoder against values from the standard (format and version bits, the Reed-Solomon
// generator, a published error-correction example), and against a small decoder written here that
// reads the matrix the way a scanner does: both format copies, unmask, un-zigzag, un-interleave,
// check every block's Reed-Solomon syndromes, read the byte-mode text back.
import { describe, expect, it } from 'vitest';
import {
  dataCodewords,
  encodeQr,
  formatBits,
  functionModules,
  gfMultiply,
  maskFlips,
  maxBytes,
  type QrCode,
  type QrLevel,
  renderQr,
  rsDivisor,
  rsRemainder,
  versionBits,
} from './qr.ts';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const bin = (n: number, len: number) => n.toString(2).padStart(len, '0');

describe('format and version information (tables in the standard)', () => {
  it('matches the published format strings', () => {
    expect(bin(formatBits('L', 0), 15)).toBe('111011111000100');
    expect(bin(formatBits('L', 1), 15)).toBe('111001011110011');
    expect(bin(formatBits('M', 0), 15)).toBe('101010000010010');
    expect(bin(formatBits('M', 1), 15)).toBe('101000100100101');
  });

  it('matches the published version strings', () => {
    expect(bin(versionBits(7), 18)).toBe('000111110010010100');
    expect(bin(versionBits(8), 18)).toBe('001000010110111100');
    expect(bin(versionBits(10), 18)).toBe('001010010011010011');
  });
});

describe('Reed-Solomon', () => {
  // The generator for 7 error correction codewords is a^0 x^7 + a^87 x^6 + a^229 x^5 + a^146 x^4 +
  // a^149 x^3 + a^238 x^2 + a^102 x + a^21 (annex A of the standard).
  it('builds the published generator polynomial for 7 codewords', () => {
    const exp = (k: number) => {
      let v = 1;
      for (let i = 0; i < k; i++) v = gfMultiply(v, 2);
      return v;
    };
    expect(rsDivisor(7)).toEqual([87, 229, 146, 149, 238, 102, 21].map(exp));
  });

  // "HELLO WORLD" at version 1, level M (16 data and 10 error correction codewords), the worked example that
  // most explanations of the standard use.
  it('gives the published error correction codewords for HELLO WORLD', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it('multiplies in GF(256)', () => {
    expect(gfMultiply(0x80, 2)).toBe(0x1d); // x^8 reduces to x^4 + x^3 + x^2 + 1
    expect(gfMultiply(0, 77)).toBe(0);
    expect(gfMultiply(1, 77)).toBe(77);
    expect(gfMultiply(3, 7)).toBe(9);
  });
});

// ---- a decoder, written separately from the encoder's placement code

const EC = {
  L: { per: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
  M: { per: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
};
const TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

function polyEval(codeword: number[], power: number): number {
  // Horner's rule at a^power, highest-order codeword first
  let x = 1;
  for (let i = 0; i < power; i++) x = gfMultiply(x, 2);
  let acc = 0;
  for (const c of codeword) acc = gfMultiply(acc, x) ^ c;
  return acc;
}

function decode(code: QrCode): { text: string; level: QrLevel; mask: number } {
  const { modules: m, size, version } = code;
  const at = (x: number, y: number) => (m[y] as boolean[])[x] as boolean;
  const num = (cells: [number, number][]) =>
    cells.reduce((acc, [x, y], i) => acc | ((at(x, y) ? 1 : 0) << i), 0);
  // both copies of the format bits
  const first = num([
    ...[0, 1, 2, 3, 4, 5].map((i): [number, number] => [8, i]),
    [8, 7],
    [8, 8],
    [7, 8],
    ...[9, 10, 11, 12, 13, 14].map((i): [number, number] => [14 - i, 8]),
  ]);
  const second = num([
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): [number, number] => [size - 1 - i, 8]),
    ...[8, 9, 10, 11, 12, 13, 14].map((i): [number, number] => [8, size - 15 + i]),
  ]);
  expect(second).toBe(first);
  let level: QrLevel | undefined;
  let mask = -1;
  for (const l of ['L', 'M'] as QrLevel[])
    for (let k = 0; k < 8; k++) if (formatBits(l, k) === first) [level, mask] = [l, k];
  if (!level) throw new Error('format bits match no level and mask');
  if (version >= 7) {
    const v = num(
      Array.from({ length: 18 }, (_, i): [number, number] => [
        size - 11 + (i % 3),
        Math.floor(i / 3),
      ]),
    );
    expect(v).toBe(versionBits(version));
  }
  // read the codewords back
  const isFunction = functionModules(version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (isFunction[y]?.[x]) continue;
        bits.push(at(x, y) !== maskFlips(mask, x, y) ? 1 : 0);
      }
  }
  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  expect(words.length).toBe(TOTAL[version - 1]);
  // un-interleave
  const blocks = EC[level].blocks[version - 1] as number;
  const ecLen = EC[level].per[version - 1] as number;
  const total = TOTAL[version - 1] as number;
  const shortCount = blocks - (total % blocks);
  const dataLens = Array.from(
    { length: blocks },
    (_, i) => Math.floor(total / blocks) - ecLen + (i < shortCount ? 0 : 1),
  );
  const data: number[][] = dataLens.map(() => []);
  const ecs: number[][] = dataLens.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(...dataLens); i++)
    dataLens.forEach((len, b) => {
      if (i < len) (data[b] as number[]).push(words[p++] as number);
    });
  for (let i = 0; i < ecLen; i++)
    for (let b = 0; b < blocks; b++) (ecs[b] as number[]).push(words[p++] as number);
  // every block is a multiple of the generator: its syndromes are all zero
  for (let b = 0; b < blocks; b++)
    for (let s = 0; s < ecLen; s++)
      expect(polyEval([...(data[b] as number[]), ...(ecs[b] as number[])], s)).toBe(0);
  // byte mode
  const stream = data.flat().flatMap((w) => bin(w, 8).split('').map(Number));
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (stream.shift() as number);
    return v;
  };
  expect(read(4)).toBe(0b0100);
  const count = read(version >= 10 ? 16 : 8);
  const out = Uint8Array.from({ length: count }, () => read(8));
  return { text: new TextDecoder().decode(out), level, mask };
}

describe('encodeQr', () => {
  it('draws the fixed patterns where the standard puts them (version 1)', () => {
    const q = encodeQr('HELLO WORLD', { level: 'M' });
    expect(q.version).toBe(1);
    expect(q.size).toBe(21);
    const row = (y: number) => q.modules[y]?.map((d) => (d ? '1' : '0')).join('');
    // the top finder pattern, its separator, and the timing pattern on row 6
    expect(row(0)?.slice(0, 8)).toBe('11111110');
    expect(row(1)?.slice(0, 8)).toBe('10000010');
    expect(row(2)?.slice(0, 8)).toBe('10111010');
    expect(row(6)?.slice(0, 8)).toBe('11111110'); // the bottom row of the finder, then its separator
    expect(row(7)?.slice(0, 8)).toBe('00000000');
    expect(row(6)?.slice(8, 13)).toBe('10101'); // the timing pattern starts dark
    expect(q.modules[13]?.[8]).toBe(true); // the dark module at (8, size - 8)
    expect(row(0)?.slice(13)).toBe('01111111'); // the top-right finder pattern, after its separator
  });

  it('reads back as the same text, at both levels', () => {
    for (const level of ['L', 'M'] as const) {
      const q = encodeQr('http://192.168.1.20:7790/#/sign-in?code=abc', { level });
      const d = decode(q);
      expect(d.text).toBe('http://192.168.1.20:7790/#/sign-in?code=abc');
      expect(d.level).toBe(level);
      expect(d.mask).toBe(q.mask);
    }
  });

  it('reads back through every mask', () => {
    for (let mask = 0; mask < 8; mask++) {
      const q = encodeQr('Remy sign in', { mask });
      expect(q.mask).toBe(mask);
      expect(decode(q).text).toBe('Remy sign in');
    }
  });

  it('picks the smallest version that fits, and the sizes the standard gives', () => {
    // Byte capacity at level M: 14, 26, 42, 62, 84, 106, 122, 152, 180, 213 minus nothing: the
    // table in the standard, for versions 1 to 10.
    const capacityM = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
    const capacityL = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
    capacityM.forEach((cap, i) => {
      const fits = encodeQr('a'.repeat(cap), { level: 'M' });
      expect(fits.version).toBe(i + 1);
      expect(fits.size).toBe(21 + 4 * i);
      if (i < 9) expect(encodeQr('a'.repeat(cap + 1), { level: 'M' }).version).toBe(i + 2);
    });
    capacityL.forEach((cap, i) => {
      expect(encodeQr('a'.repeat(cap), { level: 'L' }).version).toBe(i + 1);
      if (i < 9) expect(encodeQr('a'.repeat(cap + 1), { level: 'L' }).version).toBe(i + 2);
    });
    expect(maxBytes('M')).toBe(213);
    expect(maxBytes('L')).toBe(271);
    expect(dataCodewords(1, 'M')).toBe(16);
    expect(dataCodewords(10, 'L')).toBe(274);
  });

  it('decodes at every version and level, with text that fills the code', () => {
    for (const level of ['L', 'M'] as const)
      for (let v = 1; v <= 10; v++) {
        const fill = Math.min(maxBytes(level), Math.floor((dataCodewords(v, level) * 8 - 12) / 8));
        const text = Array.from({ length: fill }, (_, i) =>
          String.fromCharCode(33 + ((i * 7) % 90)),
        ).join('');
        const q = encodeQr(text, { level, minVersion: v });
        expect(q.version).toBe(v);
        expect(decode(q).text).toBe(text);
      }
  });

  it('encodes non-ASCII text as UTF-8', () => {
    expect(decode(encodeQr('café – Remy')).text).toBe('café – Remy');
  });

  it('falls back to level L when M does not fit, and refuses what fits nowhere', () => {
    expect(encodeQr('a'.repeat(250)).level).toBe('L');
    expect(encodeQr('a'.repeat(200)).level).toBe('M');
    expect(() => encodeQr('a'.repeat(272))).toThrow(/too long/);
    expect(() => encodeQr('a'.repeat(250), { level: 'M' })).toThrow(/too long/);
  });

  it('is the same every time, and chooses a mask with the lowest penalty', () => {
    const a = encodeQr('http://10.0.0.5:7790/#/sign-in?code=x');
    const b = encodeQr('http://10.0.0.5:7790/#/sign-in?code=x');
    expect(a.modules).toEqual(b.modules);
    expect(a.mask).toBe(b.mask);
  });

  it('keeps the fixed modules of a larger code: timing, alignment and version info', () => {
    const q = encodeQr('a'.repeat(120), { level: 'M' }); // version 7
    expect(q.version).toBe(7);
    expect(q.modules[6]?.[10]).toBe(true);
    expect(q.modules[6]?.[11]).toBe(false);
    // the alignment pattern centred at (22, 22): dark centre, light ring, dark border
    expect(q.modules[22]?.[22]).toBe(true);
    expect(q.modules[21]?.[22]).toBe(false);
    expect(q.modules[20]?.[22]).toBe(true);
    expect(q.modules[20]?.[20]).toBe(true);
  });
});

describe('renderQr', () => {
  const q = encodeQr('Remy');

  it('draws two rows of modules to a line inside a quiet zone of four modules', () => {
    const lines = renderQr(q, { color: false });
    const side = q.size + 8;
    expect(lines).toHaveLength(Math.ceil(side / 2));
    for (const l of lines) expect([...l]).toHaveLength(side);
    // the quiet zone: the first two lines hold only light modules, four columns each side too
    expect(new Set(lines[0])).toEqual(new Set(['█'])); // plain mode fills the light modules
    expect(lines[5]?.startsWith('████')).toBe(true);
    expect(lines[5]?.endsWith('████')).toBe(true);
  });

  it('is black on white whatever the terminal colours are, when colour is on', () => {
    const lines = renderQr(q, { color: true });
    for (const l of lines) {
      expect(l.startsWith('\u001b[38;5;16;48;5;231m')).toBe(true);
      expect(l.endsWith('\u001b[0m')).toBe(true);
    }
    // the top-left finder corner: dark over dark is a full block in the first line that holds it
    const body = lines.map((l) => plain(l));
    expect(body[0]).toBe(' '.repeat(q.size + 8)); // the quiet zone is blank (white)
    const firstFinderLine = body[2] as string; // modules rows 0 and 1
    expect(firstFinderLine.slice(4, 11)).toBe('█▀▀▀▀▀█'); // module rows 0 and 1 of a finder
  });

  it('draws the modules back: every half block says what its two modules are', () => {
    const quiet = 4;
    const lines = renderQr(q, { color: true }).map((l) => [...plain(l)]);
    const dark = (x: number, y: number) =>
      x >= quiet && y >= quiet && x < q.size + quiet && y < q.size + quiet
        ? q.modules[y - quiet]?.[x - quiet] === true
        : false;
    for (const [row, chars] of lines.entries())
      for (const [x, c] of chars.entries()) {
        const top = dark(x, row * 2);
        const bottom = dark(x, row * 2 + 1);
        expect(c).toBe(top ? (bottom ? '█' : '▀') : bottom ? '▄' : ' ');
      }
  });
});
