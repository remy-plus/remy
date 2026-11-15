// How a link is shown in an answer: the name of the site, not the whole address. The full address
// stays in the link, its tooltip and its accessible name.

/** Sites whose name is not just the host. Keys are hosts without `www.`. */
const KNOWN: Record<string, string> = {
  'soundguys.com': 'SoundGuys',
  'tomsguide.com': "Tom's Guide",
  'rtings.com': 'RTINGS',
  'wikipedia.org': 'Wikipedia',
  'github.com': 'GitHub',
  'nytimes.com': 'The New York Times',
  'theverge.com': 'The Verge',
  'techradar.com': 'TechRadar',
  'cnet.com': 'CNET',
  'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC',
  'reuters.com': 'Reuters',
  'youtube.com': 'YouTube',
  'stackoverflow.com': 'Stack Overflow',
  'reddit.com': 'Reddit',
  'wired.com': 'WIRED',
  'arstechnica.com': 'Ars Technica',
  'engadget.com': 'Engadget',
  'amazon.com': 'Amazon',
  'mozilla.org': 'Mozilla',
};

const hostOf = (href: string): string | null => {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};

/** A short name for the site an address points at: a known name, else the host without `www.`. */
export function siteName(href: string): string {
  const host = hostOf(href);
  if (!host) return href;
  const known = KNOWN[host] ?? KNOWN[host.split('.').slice(-2).join('.')];
  return known ?? host;
}

/** True when the text of a link is just an address, which is not worth showing. */
export const isBareUrl = (text: string): boolean => /^https?:\/\//i.test(text.trim());
