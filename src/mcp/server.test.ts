import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiClient } from '../api/client.js';
import { INVALID_PARAMS, METHOD_NOT_FOUND } from './protocol.js';
import type { JsonRpcRequest, JsonRpcResponse } from './protocol.js';
import { packageVersion } from '../cli/version.js';
import { AuthError } from '../cli/errors.js';
import {
  LATEST_PROTOCOL_VERSION,
  SERVER_NAME,
  SUPPORTED_PROTOCOL_VERSIONS,
  createHandler,
} from './server.js';
import type { McpContext } from './tools.js';

function context(allowWrite: boolean): McpContext {
  return {
    client: {
      requireAuth: () => undefined,
      getJson: async () => ({ content: [] }),
      currentUser: async () => ({ success: true, user: { email: 'ops@example.test' } }),
    } as unknown as ApiClient,
    target: {
      profileName: 'test',
      baseUrl: 'http://localhost:8080',
      token: 'token',
      refreshToken: undefined,
      orgId: undefined,
    },
    allowWrite,
    cwd: process.cwd(),
  };
}

function request(method: string, params: Record<string, unknown> = {}, id = 1): JsonRpcRequest {
  return { id, method, params };
}

interface ToolListing {
  tools: Array<{ name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }>;
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function resultOf<T>(response: JsonRpcResponse | undefined): T {
  if (!response) throw new Error('expected a response');
  if (response.error) throw new Error(`expected a result, got ${response.error.message}`);
  return response.result as T;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seatmap-cli-server-'));
  process.env.SEATMAP_CLI_CONFIG = join(dir, 'cli.json');
});

afterEach(() => {
  delete process.env.SEATMAP_CLI_CONFIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('initialize', () => {
  it('echoes a protocol version it supports', async () => {
    const response = await createHandler(context(false))(
      request('initialize', { protocolVersion: '2024-11-05' }),
    );
    expect(resultOf<{ protocolVersion: string }>(response).protocolVersion).toBe('2024-11-05');
  });

  it('falls back to the latest version for an unknown one', async () => {
    const response = await createHandler(context(false))(
      request('initialize', { protocolVersion: '1999-01-01' }),
    );
    expect(resultOf<{ protocolVersion: string }>(response).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    );
  });

  it('advertises the tools capability and the package version', async () => {
    const response = await createHandler(context(false))(request('initialize'));
    const result = resultOf<{
      capabilities: { tools: unknown };
      serverInfo: { name: string; version: string };
    }>(response);

    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe(SERVER_NAME);
    expect(result.serverInfo.version).toBe(packageVersion());
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('dispatch', () => {
  it('answers ping', async () => {
    const response = await createHandler(context(false))(request('ping'));
    expect(resultOf(response)).toEqual({});
  });

  it('stays silent for a notification', async () => {
    const handler = createHandler(context(false));
    expect(
      await handler({ id: undefined, method: 'notifications/initialized', params: {} }),
    ).toBeUndefined();
  });

  it('stays silent for a request with no id', async () => {
    const handler = createHandler(context(false));
    expect(await handler({ id: undefined, method: 'tools/list', params: {} })).toBeUndefined();
  });

  it('rejects an unsupported method', async () => {
    const handler = createHandler(context(false));
    await expect(handler(request('resources/list'))).rejects.toMatchObject({
      code: METHOD_NOT_FOUND,
    });
  });
});

describe('tools/list', () => {
  it('omits the write tool on a read-only server', async () => {
    const response = await createHandler(context(false))(request('tools/list'));
    const names = resultOf<ToolListing>(response).tools.map((entry) => entry.name);
    expect(names).toContain('seatmap_validate_spec');
    expect(names).not.toContain('seatmap_build');
  });

  it('includes the write tool once writes are allowed', async () => {
    const response = await createHandler(context(true))(request('tools/list'));
    const listing = resultOf<ToolListing>(response);
    const build = listing.tools.find((entry) => entry.name === 'seatmap_build');
    expect(build?.annotations.readOnlyHint).toBe(false);
  });

  it('marks read tools as read-only', async () => {
    const response = await createHandler(context(true))(request('tools/list'));
    const listing = resultOf<ToolListing>(response);
    const venues = listing.tools.find((entry) => entry.name === 'seatmap_list_venues');
    expect(venues?.annotations.readOnlyHint).toBe(true);
  });
});

describe('tools/call', () => {
  it('returns the tool payload as JSON text', async () => {
    const response = await createHandler(context(false))(
      request('tools/call', {
        name: 'seatmap_validate_spec',
        arguments: {
          spec: {
            schema: { name: 'Hall' },
            sections: [
              { name: 'A', type: 'grid', position: { x: 0, y: 0 }, rows: 2, seatsPerRow: 2 },
            ],
          },
        },
      }),
    );

    const result = resultOf<ToolCallResult>(response);
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { stats: { seats: number } };
    expect(payload.stats.seats).toBe(4);
  });

  it('reports a tool failure inside the result rather than as a protocol error', async () => {
    const response = await createHandler(context(false))(
      request('tools/call', { name: 'seatmap_validate_spec', arguments: { spec: { schema: {} } } }),
    );

    const result = resultOf<ToolCallResult>(response);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.length).toBeGreaterThan(0);
  });

  it('raises a protocol error for an unknown tool', async () => {
    const handler = createHandler(context(false));
    await expect(handler(request('tools/call', { name: 'nope' }))).rejects.toMatchObject({
      code: INVALID_PARAMS,
    });
  });

  it('raises a protocol error when a write tool is called read-only', async () => {
    const handler = createHandler(context(false));
    await expect(
      handler(request('tools/call', { name: 'seatmap_build', arguments: {} })),
    ).rejects.toThrow(/--allow-write/);
  });

  it('requires a tool name', async () => {
    const handler = createHandler(context(false));
    await expect(handler(request('tools/call', {}))).rejects.toMatchObject({
      code: INVALID_PARAMS,
    });
  });

  it('treats missing arguments as an empty object', async () => {
    const response = await createHandler(context(false))(
      request('tools/call', { name: 'seatmap_session' }),
    );
    const result = resultOf<ToolCallResult>(response);
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { writesEnabled: boolean };
    expect(payload.writesEnabled).toBe(false);
  });
});

describe('authentication', () => {
  function tokenless(): McpContext {
    const base = context(false);
    return {
      ...base,
      client: {
        requireAuth: () => {
          throw new AuthError('Not authenticated against http://localhost:8080.');
        },
        getJson: async () => ({ content: [] }),
        currentUser: async () => ({ success: true }),
      } as unknown as ApiClient,
      target: { ...base.target, token: undefined },
    };
  }

  it('refuses a read tool without a session', async () => {
    const response = await createHandler(tokenless())(
      request('tools/call', { name: 'seatmap_list_venues' }),
    );
    const result = resultOf<ToolCallResult>(response);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Not authenticated/);
  });

  it('still answers the session tool without one', async () => {
    const response = await createHandler(tokenless())(
      request('tools/call', { name: 'seatmap_session' }),
    );
    const result = resultOf<ToolCallResult>(response);
    expect(result.isError).toBe(false);
  });

  it('still compiles a spec without one', async () => {
    const response = await createHandler(tokenless())(
      request('tools/call', {
        name: 'seatmap_validate_spec',
        arguments: {
          spec: {
            schema: { name: 'Hall' },
            sections: [
              { name: 'A', type: 'grid', position: { x: 0, y: 0 }, rows: 2, seatsPerRow: 2 },
            ],
          },
        },
      }),
    );
    expect(resultOf<ToolCallResult>(response).isError).toBe(false);
  });
});

describe('error detail', () => {
  it('carries the hint through to the tool result', async () => {
    const response = await createHandler(context(false))(
      request('tools/call', {
        name: 'seatmap_validate_spec',
        arguments: { path: 'spec.mjs' },
      }),
    );
    const result = resultOf<ToolCallResult>(response);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/only JSON specs are accepted/);
    expect(result.content[0]?.text).toMatch(/Compile the module to JSON first/);
  });
});

describe('protocol versions', () => {
  it('no longer advertises a revision whose batching it cannot serve', () => {
    const supported: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;
    expect(supported).not.toContain('2025-03-26');
  });
});

describe('tool annotations', () => {
  it('marks the write tool destructive', async () => {
    const response = await createHandler(context(true))(request('tools/list'));
    const listing = resultOf<ToolListing>(response);
    const build = listing.tools.find((entry) => entry.name === 'seatmap_build');
    expect(build?.annotations.destructiveHint).toBe(true);
  });
});
