/**
 * Where the cursor sits once the text is wrapped at `width` columns: rows and columns from 0.
 * Lines break at "\n" and, when longer than `width`, every `width` characters. A cursor right after
 * a full row sits at column 0 of the next row, so the view should leave room for that row.
 * Counts code units, so wide characters and emoji are off by their extra cells.
 */
export function cursorPosition(
  text: string,
  cursor: number,
  width: number,
): { row: number; col: number } {
  const w = Math.max(1, width);
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length))).split('\n');
  let row = 0;
  for (let i = 0; i < before.length - 1; i++)
    row += Math.max(1, Math.ceil((before[i] as string).length / w));
  const last = (before[before.length - 1] as string).length;
  return { row: row + Math.floor(last / w), col: last % w };
}
