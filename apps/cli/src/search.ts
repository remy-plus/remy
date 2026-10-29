// Which service answers web_search. The user picks; without a pick, a service whose key is set
// wins, then Remy's own browser.
import {
  braveSearch,
  contextDevSearch,
  type SearchProvider,
  searxngSearch,
  tavilySearch,
} from '@remy/tools';

export const SEARCH_CHOICES = ['browser', 'context', 'brave', 'tavily', 'searxng', 'off'] as const;
export type SearchChoice = (typeof SEARCH_CHOICES)[number];

const SERVICES: Record<
  Exclude<SearchChoice, 'browser' | 'off'>,
  { env: string; make: (value: string) => SearchProvider }
> = {
  context: { env: 'CONTEXT_DEV_API_KEY', make: contextDevSearch },
  brave: { env: 'BRAVE_API_KEY', make: braveSearch },
  tavily: { env: 'TAVILY_API_KEY', make: tavilySearch },
  searxng: { env: 'SEARXNG_URL', make: searxngSearch },
};

export const isSearchChoice = (v: string): v is SearchChoice =>
  (SEARCH_CHOICES as readonly string[]).includes(v);

/**
 * `choice` from REMY_SEARCH or remy.config.json. `browser` means Remy's browser does the
 * searching (when the browser is off, there is no search); `off` means no web_search at all.
 */
export function pickSearch(
  env: Record<string, string | undefined>,
  picked: string | undefined,
): { choice: SearchChoice; provider?: SearchProvider } {
  const want = picked?.trim().toLowerCase();
  if (want) {
    if (!isSearchChoice(want))
      throw new Error(`REMY_SEARCH must be one of ${SEARCH_CHOICES.join(', ')}, not "${picked}".`);
    if (want === 'browser' || want === 'off') return { choice: want };
    const s = SERVICES[want];
    const value = env[s.env];
    if (!value)
      throw new Error(
        `Search through ${want} needs ${s.env}. Set it, or pick another with REMY_SEARCH.`,
      );
    return { choice: want, provider: s.make(value) };
  }
  for (const [name, s] of Object.entries(SERVICES)) {
    const value = env[s.env];
    if (value) return { choice: name as SearchChoice, provider: s.make(value) };
  }
  return { choice: 'browser' };
}
