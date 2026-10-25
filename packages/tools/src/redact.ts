/** Returns a function that replaces known secret values with `[REDACTED:NAME]`. Values under 4 chars are ignored. */
export function createRedactor(secrets: Record<string, string>): (text: string) => string {
  const entries = Object.entries(secrets)
    .filter(([, v]) => v.length >= 4)
    .sort((a, b) => b[1].length - a[1].length); // longest first, so overlaps redact fully
  return (text) => {
    let out = text;
    for (const [name, value] of entries) out = out.replaceAll(value, `[REDACTED:${name}]`);
    return out;
  };
}
