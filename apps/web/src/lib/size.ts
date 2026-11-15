/** A file size in plain units: "16 B", "1.4 KB", "3 MB". */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes;
  let i = -1;
  do {
    n /= 1000;
    i++;
  } while (n >= 1000 && i < units.length - 1);
  return `${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)} ${units[i]}`;
}
