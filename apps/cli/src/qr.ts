// A small QR code encoder (ISO/IEC 18004), so `remy serve` can show a sign-in link a phone camera
// reads. Byte mode only, error correction levels L and M, versions 1 to 10 (a link of up to 213
// characters at L). No dependency. The steps follow the standard: the data bits, Reed-Solomon over
// GF(256) per block, block interleaving, the function patterns, the zigzag placement, the eight
// masks scored by the four penalty rules, then the format and version bits.

export type QrLevel = 'L' | 'M';

export interface QrCode {
  version: number;
  /** Modules on a side: 17 + 4 * version. */
  size: number;
  level: QrLevel;
  mask: number;
  /** `modules[y][x]` is true for a dark module. No quiet zone. */
  modules: boolean[][];
}

export const QR_MAX_VERSION = 10;

/** Total codewords (data and error correction) of versions 1 to 10. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
/** Error correction codewords in each block, by version 1 to 10. */
const EC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
};
/** Blocks, by version 1 to 10. */
const BLOCKS: Record<QrLevel, number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
};
/** The two level bits in the format information. */
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0 };
/** Alignment pattern centres, by version 2 to 10 (version 1 has none). */
const ALIGNMENT: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const sizeOf = (version: number) => 17 + 4 * version;

/** Data codewords a version holds at a level. */
export function dataCodewords(version: number, level: QrLevel): number {
  return (
    (TOTAL_CODEWORDS[version - 1] as number) -
    (EC_PER_BLOCK[level][version - 1] as number) * (BLOCKS[level][version - 1] as number)
  );
}

/** The most bytes one code holds at a level (version 10). */
export function maxBytes(level: QrLevel): number {
  return Math.floor((dataCodewords(QR_MAX_VERSION, level) * 8 - 4 - 16) / 8);
}

// ---- Reed-Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)

export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial of the given degree, without its leading 1 coefficient. */
export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j] as number, root);
      if (j + 1 < degree) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

/** The error correction codewords of `data`, as many as `divisor` has coefficients. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] as number) ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

// ---- format and version information (BCH codes)

/** The 15 format bits for a level and mask, already XORed with 101010000010010. */
export function formatBits(level: QrLevel, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---- the matrix

const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0;

/** Which modules are patterns (finders, timing, alignment, format, version), not data. */
export function functionModules(version: number): boolean[][] {
  const size = sizeOf(version);
  const f = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number) => {
    (f[y] as boolean[])[x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i);
    set(i, 6);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const centres = ALIGNMENT[version - 1] as number[];
  const n = centres.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set((centres[i] as number) + dx, (centres[j] as number) + dy);
    }
  for (let i = 0; i < 9; i++) {
    set(8, i);
    set(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8);
    set(8, size - 1 - i);
  }
  if (version >= 7)
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b);
      set(b, a);
    }
  return f;
}

/** True where the mask flips the module at column x, row y. */
export function maskFlips(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error('A mask is 0 to 7.');
  }
}

/** Data and error correction codewords, interleaved across blocks as the standard orders them. */
function interleave(data: number[], version: number, level: QrLevel): number[] {
  const blocks = BLOCKS[level][version - 1] as number;
  const ecLen = EC_PER_BLOCK[level][version - 1] as number;
  const total = TOTAL_CODEWORDS[version - 1] as number;
  const shortCount = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks) - ecLen;
  const divisor = rsDivisor(ecLen);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let at = 0;
  for (let i = 0; i < blocks; i++) {
    const len = shortLen + (i < shortCount ? 0 : 1);
    const block = data.slice(at, at + len);
    at += len;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLen; i++)
    for (const b of dataBlocks) if (i < b.length) out.push(b[i] as number);
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i] as number);
  return out;
}

/** The data bits of `bytes` in byte mode, padded to the version's data capacity. */
function dataCodewordsFor(bytes: Uint8Array, version: number, level: QrLevel): number[] | null {
  const capacity = dataCodewords(version, level) * 8;
  const countBits = version >= 10 ? 16 : 8;
  if (bytes.length >= 1 << countBits) return null;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);
  if (bits.length > capacity) return null;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | (bits[i + j] as number);
    words.push(w);
  }
  for (let pad = 0xec; words.length < capacity / 8; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

function penalty(m: boolean[][]): number {
  const size = m.length;
  const at = (x: number, y: number) => (m[y] as boolean[])[x] as boolean;
  let score = 0;
  // N1: five or more in a row or column of one colour
  for (const vertical of [false, true]) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        const same = b < size && (vertical ? at(a, b) === at(a, b - 1) : at(b, a) === at(b - 1, a));
        if (same) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }
  }
  // N2: 2 by 2 blocks of one colour
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  // N3: 1:1:3:1:1 with four light modules on one side
  const a = [true, false, true, true, true, false, true, false, false, false, false];
  const b = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (get: (i: number) => boolean, p: boolean[]) => p.every((v, i) => get(i) === v);
  for (let r = 0; r < size; r++)
    for (let s = 0; s + 11 <= size; s++) {
      for (const p of [a, b]) {
        if (matches((i) => at(s + i, r), p)) score += 40;
        if (matches((i) => at(r, s + i), p)) score += 40;
      }
    }
  // N4: how far the share of dark modules is from half
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

function build(
  codewords: number[],
  version: number,
  level: QrLevel,
  mask: number,
  isFunction: boolean[][],
): boolean[][] {
  const size = sizeOf(version);
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const put = (x: number, y: number, dark: boolean) => {
    (m[y] as boolean[])[x] = dark;
  };
  // timing
  for (let i = 0; i < size; i++) {
    put(6, i, i % 2 === 0);
    put(i, 6, i % 2 === 0);
  }
  // finders with their separators
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) put(x, y, dist !== 2 && dist !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // alignment
  const centres = ALIGNMENT[version - 1] as number[];
  const n = centres.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          put(
            (centres[i] as number) + dx,
            (centres[j] as number) + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
    }
  // data, in the zigzag the standard describes
  let i = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!(isFunction[y] as boolean[])[x] && i < total) {
          put(x, y, bit(codewords[i >>> 3] as number, 7 - (i & 7)));
          i++;
        }
      }
  }
  // the mask, on data modules only
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (!(isFunction[y] as boolean[])[x] && maskFlips(mask, x, y))
        put(x, y, !(m[y] as boolean[])[x]);
  // format information, twice
  const fmt = formatBits(level, mask);
  for (let k = 0; k <= 5; k++) put(8, k, bit(fmt, k));
  put(8, 7, bit(fmt, 6));
  put(8, 8, bit(fmt, 7));
  put(7, 8, bit(fmt, 8));
  for (let k = 9; k < 15; k++) put(14 - k, 8, bit(fmt, k));
  for (let k = 0; k < 8; k++) put(size - 1 - k, 8, bit(fmt, k));
  for (let k = 8; k < 15; k++) put(8, size - 15 + k, bit(fmt, k));
  put(8, size - 8, true); // the one fixed dark module
  // version information
  if (version >= 7) {
    const v = versionBits(version);
    for (let k = 0; k < 18; k++) {
      const a = size - 11 + (k % 3);
      const b = Math.floor(k / 3);
      put(a, b, bit(v, k));
      put(b, a, bit(v, k));
    }
  }
  return m;
}

/**
 * Encodes text (as UTF-8 bytes) in byte mode. Picks the smallest version that fits and the mask
 * with the lowest penalty. Level M unless `level` says otherwise; at M, text too long for version
 * 10 is tried at L. Throws when it fits nowhere.
 */
export function encodeQr(
  text: string,
  opts: { level?: QrLevel; mask?: number; minVersion?: number } = {},
): QrCode {
  const bytes = new TextEncoder().encode(text);
  const levels: QrLevel[] = opts.level ? [opts.level] : ['M', 'L'];
  for (const level of levels)
    for (let version = Math.max(1, opts.minVersion ?? 1); version <= QR_MAX_VERSION; version++) {
      const data = dataCodewordsFor(bytes, version, level);
      if (!data) continue;
      const codewords = interleave(data, version, level);
      const isFunction = functionModules(version);
      let best: { mask: number; modules: boolean[][]; score: number } | undefined;
      for (const mask of opts.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [opts.mask]) {
        const modules = build(codewords, version, level, mask, isFunction);
        const score = penalty(modules);
        if (!best || score < best.score) best = { mask, modules, score };
      }
      const chosen = best as NonNullable<typeof best>;
      return {
        version,
        size: sizeOf(version),
        level,
        mask: chosen.mask,
        modules: chosen.modules,
      };
    }
  throw new Error('That text is too long for a QR code.');
}

/**
 * Draws a code with Unicode half blocks, two rows of modules to a line, inside a quiet zone of four
 * modules (the standard's width) on every side. With `color`, the whole block is black on white,
 * whatever the terminal's own colours are. Without it, the light modules are the filled ones, which
 * reads as dark on light in a terminal with light text on a dark background (a phone camera also
 * reads the other way round).
 */
export function renderQr(code: QrCode, opts: { color: boolean; quiet?: number }): string[] {
  const quiet = opts.quiet ?? 4;
  const side = code.size + 2 * quiet;
  const dark = (x: number, y: number) => {
    const mx = x - quiet;
    const my = y - quiet;
    return mx >= 0 && my >= 0 && mx < code.size && my < code.size
      ? ((code.modules[my] as boolean[])[mx] as boolean)
      : false;
  };
  const lines: string[] = [];
  for (let y = 0; y < side; y += 2) {
    let line = '';
    for (let x = 0; x < side; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      if (opts.color) line += top ? (bottom ? '█' : '▀') : bottom ? '▄' : ' ';
      else line += top ? (bottom ? ' ' : '▄') : bottom ? '▀' : '█';
    }
    lines.push(opts.color ? `\u001b[38;5;16;48;5;231m${line}\u001b[0m` : line);
  }
  return lines;
}
