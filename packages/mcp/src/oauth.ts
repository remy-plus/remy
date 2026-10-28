// OAuth for remote servers. The SDK does the protocol (discovery, registration, PKCE, refresh);
// this file is the one place the app reaches it from, so the app never imports the SDK itself.

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthClientProvider, OAuthTokens };

export interface AuthorizeOptions {
  /** The MCP endpoint of the remote server. */
  serverUrl: string;
  provider: OAuthClientProvider;
  /**
   * Called once the provider has been sent to the authorization URL (its `redirectToAuthorization`
   * ran). Resolves with the code the redirect brought back; rejects on timeout, cancel or a bad state.
   */
  waitForCode: () => Promise<string>;
  fetchFn?: typeof fetch;
}

/**
 * Signs in: discovers the server's authorization service, registers if needed, sends the user to
 * the browser step (through `provider.redirectToAuthorization`), waits for the code and exchanges
 * it. Returns without waiting when the stored tokens already work.
 */
export async function authorizeWithProvider(o: AuthorizeOptions): Promise<'signed_in' | 'already'> {
  const fetchFn = o.fetchFn;
  const first = await auth(o.provider, {
    serverUrl: o.serverUrl,
    ...(fetchFn && { fetchFn }),
  });
  if (first === 'AUTHORIZED') return 'already';
  const code = await o.waitForCode();
  const second = await auth(o.provider, {
    serverUrl: o.serverUrl,
    authorizationCode: code,
    ...(fetchFn && { fetchFn }),
  });
  if (second !== 'AUTHORIZED') throw new Error('The server did not accept the sign-in.');
  return 'signed_in';
}
