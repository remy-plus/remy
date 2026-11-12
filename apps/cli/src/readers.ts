// Which reading service `fetch_url` may fall back to (Firecrawl or Cloudflare Browser Rendering),
// from keys in the environment or the Keychain. REMY_READER=firecrawl|cloudflare|off overrides;
// REMY_READER=always also reads every page through the picked service first.
import { cloudflareReader, firecrawlReader, type PageReader } from '@remy/tools';
import { type KeySource, readServiceKey, type ServiceKeyOptions } from './service-keys.ts';

export type ReaderId = 'firecrawl' | 'cloudflare';

export interface ReaderSetup {
  reader?: PageReader;
  id?: ReaderId;
  /** `always`: try the service before the direct fetch. */
  always: boolean;
  /** REMY_READER named it (or switched readers off). */
  override: boolean;
  off: boolean;
  /** Keys read from the Keychain, to register for redaction. */
  found: { name: string; value: string }[];
  /** Where each key came from. */
  sources: Record<'firecrawl' | 'cloudflare-account' | 'cloudflare', KeySource>;
  /** Plain-English lines for `remy search` and the doctor. */
  lines: string[];
}

const NAMES = {
  firecrawl: 'FIRECRAWL_API_KEY',
  'cloudflare-account': 'CLOUDFLARE_ACCOUNT_ID',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
} as const;

const where = (name: string, s: KeySource) =>
  s === 'env' ? `env (${name})` : s === 'keychain' ? 'Keychain' : 'none';

export async function resolveReader(
  env: Record<string, string | undefined>,
  opts: ServiceKeyOptions & { fetch?: typeof fetch } = {},
): Promise<ReaderSetup> {
  const raw = env.REMY_READER?.trim().toLowerCase() ?? '';
  const always = raw === 'always';
  const want = always ? '' : raw;
  const read = async (acct: keyof typeof NAMES) => readServiceKey(NAMES[acct], acct, env, opts);
  const [fc, cfAcct, cfTok] = await Promise.all([
    read('firecrawl'),
    read('cloudflare-account'),
    read('cloudflare'),
  ]);
  const sources = {
    firecrawl: fc.source,
    'cloudflare-account': cfAcct.source,
    cloudflare: cfTok.source,
  };
  const found = (
    [
      [NAMES.firecrawl, fc],
      [NAMES['cloudflare-account'], cfAcct],
      [NAMES.cloudflare, cfTok],
    ] as const
  ).flatMap(([name, r]) => (r.source === 'keychain' && r.value ? [{ name, value: r.value }] : []));
  const f = opts.fetch ? { fetch: opts.fetch } : {};
  const firecrawl = () => (fc.value ? firecrawlReader(fc.value, f) : undefined);
  const cloudflare = () =>
    cfAcct.value && cfTok.value ? cloudflareReader(cfAcct.value, cfTok.value, f) : undefined;

  let id: ReaderId | undefined;
  let why = '';
  let off = false;
  if (want === 'off') {
    off = true;
    why = 'Page readers are off (REMY_READER=off).';
  } else if (want === 'firecrawl' || want === 'cloudflare') {
    id = want;
    if (!(want === 'firecrawl' ? firecrawl() : cloudflare())) {
      why = `REMY_READER picks ${want === 'firecrawl' ? 'Firecrawl' : 'Cloudflare'} but its key is not set.`;
      id = undefined;
    }
  } else if (want) {
    why = `REMY_READER is "${env.REMY_READER}", which is not a reader. Use firecrawl, cloudflare, always or off.`;
  } else if (firecrawl()) id = 'firecrawl';
  else if (cloudflare()) id = 'cloudflare';

  const reader = !off && id ? (id === 'firecrawl' ? firecrawl() : cloudflare()) : undefined;
  const lines: string[] = [];
  if (why) lines.push(why);
  else if (reader)
    lines.push(
      `Pages Remy cannot read directly go to ${reader.name}${always ? ' (every page, REMY_READER=always)' : ''}. Private and local addresses are never sent to it.`,
    );
  else
    lines.push(
      'No page reader set. Optional: a Firecrawl key (FIRECRAWL_API_KEY) or Cloudflare Browser Rendering (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN) reads blocked or script-only pages.',
    );
  lines.push(
    `  firecrawl   key: ${where(NAMES.firecrawl, sources.firecrawl)}`,
    `  cloudflare  account: ${where(NAMES['cloudflare-account'], sources['cloudflare-account'])}, token: ${where(NAMES.cloudflare, sources.cloudflare)}`,
  );
  return {
    ...(reader && { reader }),
    ...(id && reader && { id }),
    always,
    override: Boolean(raw && !always),
    off,
    found,
    sources,
    lines,
  };
}

/** The lines `remy search` and the doctor show about page readers. */
export async function readerStatus(
  env: Record<string, string | undefined>,
  opts: ServiceKeyOptions = {},
): Promise<string[]> {
  return (await resolveReader(env, opts)).lines;
}
