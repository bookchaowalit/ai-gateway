/**
 * MCP server for the Central AI Gateway: read-only tools over its authenticated status endpoint.
 *
 * Every tool is one `GET /api/ai/status` call (scope `api:read`) with the caller's own scoped bearer token. There is
 * no database or file access, no generate/route tool (nothing that spends provider budget), and no tool accepts an
 * actor, workspace, tenant, delegation or token argument: tool inputs are strict, so unknown arguments are rejected
 * before any HTTP call. Errors are a fixed message from the HTTP status; upstream text is never included.
 *
 *   EMPIRE_AI_GATEWAY_API=https://...   env, else the owner-only ~/.config/empire-platform/client.env
 *   EMPIRE_TOKEN=...                    scoped gateway token, else
 *   EMPIRE_TOKEN_FILE=/path/token       a token file (mode 600), else
 *   ~/.config/solo-empire/production-tools.ai-gateway.token (mode 600)
 */

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export const URL_KEY = 'EMPIRE_AI_GATEWAY_API';
export const FORBIDDEN_ARGUMENTS = [
  'actor', 'actor_id', 'workspace', 'workspace_id', 'tenant', 'tenant_id', 'delegation', 'token', 'authorization', 'owner_id',
] as const;
const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const REASONS: Record<number, string> = {
  400: 'invalid', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'invalid', 409: 'conflict',
  410: 'not_found', 413: 'invalid', 422: 'invalid', 429: 'rate_limited',
};

export class ConfigError extends Error {}
export class ToolFailed extends Error {}

/** A fixed message from the status alone: upstream text and detail fields are never included. */
export function failure(status: number): string {
  return `${status}: ${status >= 500 ? 'upstream_error' : (REASONS[status] ?? 'error')}`;
}

type Env = Record<string, string | undefined>;

function ownerOnly(path: string, what: string): string {
  if (statSync(path).mode & 0o077) throw new ConfigError(`${what} file ${path} must be readable by its owner only (chmod 600)`);
  return readFileSync(path, 'utf8');
}

function clientFile(env: Env, home: string): Record<string, string> {
  const override = (env.EMPIRE_CLIENT_CONFIG ?? '').trim();
  const path = override || join(home, '.config', 'empire-platform', 'client.env');
  let text: string;
  try {
    text = ownerOnly(path, 'client config');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error instanceof ConfigError ? error : new ConfigError('the client config cannot be read');
  }
  const values: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const at = line.indexOf('=');
    if (line && !line.startsWith('#') && at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

/** The API base URL: https only (http on loopback), no credentials, query or fragment. */
export function apiUrl(env: Env = process.env, home = homedir()): string {
  const value = (env[URL_KEY] ?? '').trim() || clientFile(env, home)[URL_KEY] || '';
  if (!value) throw new ConfigError(`the API is not configured: set ${URL_KEY} (env or client.env)`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${URL_KEY} is not a valid URL`);
  }
  if (url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#')) {
    throw new ConfigError(`${URL_KEY} must not carry credentials, a query or a fragment`);
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname.toLowerCase())))) {
    throw new ConfigError(`${URL_KEY} must be https (http only for 127.0.0.1, ::1 or localhost)`);
  }
  return value.replace(/\/+$/, '');
}

/** The token without surrounding whitespace; inner whitespace or a control character is refused, never echoed. */
export function cleanToken(value: string): string {
  const token = value.trim();
  // eslint-disable-next-line no-control-regex
  if (!token || /[\s\u0000-\u001f\u007f]/.test(token)) throw new ConfigError('the token has an unexpected format');
  return token;
}

export function bearer(env: Env = process.env, home = homedir()): string {
  if (env.EMPIRE_TOKEN) return cleanToken(env.EMPIRE_TOKEN);
  const read = (path: string) => {
    try {
      return cleanToken(ownerOnly(path, 'token'));
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError('the token file cannot be read');
    }
  };
  if (env.EMPIRE_TOKEN_FILE) return read(env.EMPIRE_TOKEN_FILE);
  const fallback = join(home, '.config', 'solo-empire', 'production-tools.ai-gateway.token');
  try {
    statSync(fallback);
  } catch {
    throw new ConfigError('no token: set EMPIRE_TOKEN or EMPIRE_TOKEN_FILE');
  }
  return read(fallback);
}

export interface Options {
  baseUrl: string;
  token: () => string;
  fetchImpl?: typeof fetch;
}

const NoArguments = z.strictObject({});

export function createServer({ baseUrl, token, fetchImpl = fetch }: Options): McpServer {
  const server = new McpServer(
    { name: 'ai-gateway', version: '0.1.0' },
    { instructions: 'Solo Empire central AI gateway: read-only usage, budget and rate-limit status as the authenticated caller.' },
  );

  async function status(): Promise<Record<string, unknown>> {
    let bearerToken: string;
    try {
      bearerToken = cleanToken(token());
    } catch {
      throw new ToolFailed(failure(401));
    }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/api/ai/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json', 'X-Empire-Channel': 'mcp' },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ToolFailed(failure(503)); // never echo the transport error
    }
    if (response.status >= 300) throw new ToolFailed(failure(response.status));
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
    } catch {
      /* falls through to the fixed error */
    }
    throw new ToolFailed(failure(502));
  }

  function tool(name: string, description: string, pick: (body: Record<string, unknown>) => unknown): void {
    server.registerTool(name, { description, inputSchema: NoArguments, annotations: { readOnlyHint: true } }, async () => {
      try {
        const body = pick(await status());
        return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] };
      } catch (error) {
        const message = error instanceof ToolFailed ? error.message : failure(500);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    });
  }

  tool('ai_gateway.status', 'Gateway status: configured routes and providers, budget, rate limit and service info.', (b) => b);
  tool('ai_gateway.budget', 'The gateway usage and budget report (spend and limits).', (b) => ({ budget: b.budget ?? null }));
  tool('ai_gateway.rate_limit', 'The gateway rate-limiter status.', (b) => ({ rate_limit: b.rate_limit ?? null }));
  return server;
}

export async function main(): Promise<void> {
  let server: McpServer;
  try {
    const baseUrl = apiUrl();
    bearer(); // fail at start-up, not on the first call
    server = createServer({ baseUrl, token: () => bearer() });
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : 'configuration error');
    process.exit(1);
  }
  await server.connect(new StdioServerTransport());
}
