// A tiny OAuth-protected MCP server over real HTTP on 127.0.0.1, for tests. Not part of the build.
// It speaks just enough: protected-resource and authorization-server metadata, dynamic client
// registration, an authorize endpoint that redirects straight back with a code (so a test "browser"
// is one fetch), PKCE-checked token exchange and refresh, and a stateless /mcp with one tool.
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export interface FakeOAuthServer {
  /** The MCP endpoint, `http://127.0.0.1:<port>/mcp`. */
  url: string;
  /** What the authorize endpoint saw on each request. */
  authorizeRequests: Record<string, string>[];
  registrations: number;
  tokenRequests: { grant: string }[];
  /** Makes every access token handed out so far stop working (the refresh token still works). */
  expireAccessTokens(): void;
  /** Makes the refresh token stop working too. */
  revokeEverything(): void;
  /** The state the authorize endpoint sends back instead of the one it was given (a hostile redirect). */
  forceState: string | undefined;
  close(): Promise<void>;
}

const b64url = (b: Buffer) => b.toString('base64url');

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function fakeOAuthServer(): Promise<FakeOAuthServer> {
  let base = '';
  const codes = new Map<string, { challenge: string }>();
  let validAccess = new Set<string>();
  let validRefresh = new Set<string>();
  let counter = 0;
  const fake: FakeOAuthServer = {
    url: '',
    authorizeRequests: [],
    registrations: 0,
    tokenRequests: [],
    forceState: undefined,
    expireAccessTokens: () => {
      validAccess = new Set();
    },
    revokeEverything: () => {
      validAccess = new Set();
      validRefresh = new Set();
    },
    close: () => new Promise((r) => http.close(() => r())),
  };
  const json = (res: ServerResponse, status: number, data: unknown, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(data));
  };
  const mint = () => {
    counter++;
    const access = `at-${counter}`;
    const refresh = `rt-${counter}`;
    validAccess.add(access);
    validRefresh.add(refresh);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 };
  };

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    try {
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
        return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server'))
        return json(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      if (url.pathname === '/register' && req.method === 'POST') {
        fake.registrations++;
        const meta = JSON.parse(await body(req)) as Record<string, unknown>;
        return json(res, 201, { ...meta, client_id: `client-${fake.registrations}` });
      }
      if (url.pathname === '/authorize') {
        const q = Object.fromEntries(url.searchParams);
        fake.authorizeRequests.push(q);
        const code = randomUUID();
        codes.set(code, { challenge: q.code_challenge ?? '' });
        const back = new URL(q.redirect_uri ?? '');
        back.searchParams.set('code', code);
        if (q.state !== undefined) back.searchParams.set('state', fake.forceState ?? q.state);
        res.writeHead(302, { location: back.toString() });
        return void res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const form = new URLSearchParams(await body(req));
        const grant = form.get('grant_type') ?? '';
        fake.tokenRequests.push({ grant });
        if (grant === 'authorization_code') {
          const entry = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? '');
          const verifier = form.get('code_verifier') ?? '';
          const ok =
            entry && b64url(createHash('sha256').update(verifier).digest()) === entry.challenge;
          return ok ? json(res, 200, mint()) : json(res, 400, { error: 'invalid_grant' });
        }
        if (grant === 'refresh_token' && validRefresh.has(form.get('refresh_token') ?? '')) {
          validRefresh.delete(form.get('refresh_token') ?? '');
          return json(res, 200, mint());
        }
        return json(res, 400, { error: 'invalid_grant' });
      }
      if (url.pathname === '/mcp') {
        const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        if (!token || !validAccess.has(token))
          return json(
            res,
            401,
            { error: 'unauthorized' },
            {
              'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
            },
          );
        const server = new Server(
          { name: 'fake-oauth', version: '1.0.0' },
          { capabilities: { tools: {} } },
        );
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [{ name: 'ping', inputSchema: { type: 'object', properties: {} } }],
        }));
        server.setRequestHandler(CallToolRequestSchema, async () => ({
          content: [{ type: 'text', text: 'pong' }],
        }));
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => void transport.close());
        await server.connect(transport);
        const raw = await body(req);
        return await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
      }
      res.writeHead(404).end();
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: String(e) });
    }
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  fake.url = `${base}/mcp`;
  return fake;
}
