import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ApiClient } from '../api/client.js';
import { RefusedError } from '../cli/errors.js';
import { RpcError } from './protocol.js';
import { availableTools, findTool, TOOLS } from './tools.js';
import type { McpContext, ToolDefinition } from './tools.js';

const SPEC = {
  schema: { name: 'Inline Hall' },
  sections: [
    {
      name: 'A',
      type: 'grid',
      position: { x: 0, y: 0 },
      rows: 3,
      seatsPerRow: 4,
    },
  ],
};

interface ClientCall {
  method: string;
  path: string;
}

function stubClient(calls: ClientCall[], responses: Record<string, unknown> = {}): ApiClient {
  const record = (method: string, path: string): unknown => {
    calls.push({ method, path });
    return responses[`${method} ${path}`];
  };
  return {
    requireAuth: () => undefined,
    getJson: async (path: string) => record('GET', path),
    postJson: async (path: string) => record('POST', path),
    putJson: async (path: string) => record('PUT', path),
    currentUser: async () => ({ success: true, user: { email: 'ops@example.test' } }),
  } as unknown as ApiClient;
}

function contextFor(
  baseUrl: string,
  options: { allowWrite?: boolean; client?: ApiClient; token?: string } = {},
): McpContext {
  return {
    client: options.client ?? stubClient([]),
    target: {
      profileName: 'test',
      baseUrl,
      token: options.token ?? 'token',
      refreshToken: undefined,
      orgId: 4,
    },
    allowWrite: options.allowWrite ?? false,
    cwd: process.cwd(),
  };
}

function tool(name: string): ToolDefinition {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seatmap-cli-mcp-'));
  process.env.SEATMAP_CLI_CONFIG = join(dir, 'cli.json');
  delete process.env.SEATMAP_CLI_PRODUCTION_HOSTS;
});

afterEach(() => {
  delete process.env.SEATMAP_CLI_CONFIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('tool visibility', () => {
  it('hides mutating tools from a read-only server', () => {
    const names = availableTools(false).map((entry) => entry.name);
    expect(names).not.toContain('seatmap_build');
    expect(names).toContain('seatmap_validate_spec');
  });

  it('exposes mutating tools once writes are allowed', () => {
    expect(availableTools(true).map((entry) => entry.name)).toContain('seatmap_build');
  });

  it('refuses to resolve a write tool on a read-only server', () => {
    expect(() => findTool('seatmap_build', false)).toThrow(/--allow-write/);
  });

  it('refuses an unknown tool name', () => {
    expect(() => findTool('seatmap_nope', true)).toThrow(RpcError);
  });

  it('gives every tool a name, a title and an object schema', () => {
    for (const entry of TOOLS) {
      expect(entry.name).toMatch(/^seatmap_[a-z_]+$/);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.inputSchema.type).toBe('object');
    }
  });
});

describe('seatmap_validate_spec', () => {
  it('compiles an inline spec without touching the API', async () => {
    const calls: ClientCall[] = [];
    const result = (await tool('seatmap_validate_spec').run(
      { spec: SPEC },
      contextFor('http://localhost:8080', { client: stubClient(calls) }),
    )) as { source: string; stats: { seats: number; rows: number } };

    expect(calls).toEqual([]);
    expect(result.source).toBe('inline');
    expect(result.stats.rows).toBe(3);
    expect(result.stats.seats).toBe(12);
  });

  it('compiles a spec read from a file', async () => {
    const result = (await tool('seatmap_validate_spec').run(
      { path: 'examples/smoke.json' },
      contextFor('http://localhost:8080'),
    )) as { source: string; stats: { sections: number; gaSections: number } };

    expect(result.source).toBe(resolve(process.cwd(), 'examples/smoke.json'));
    expect(result.stats.sections).toBe(5);
    expect(result.stats.gaSections).toBe(3);
  });

  it('rejects a spec and a path together', async () => {
    await expect(
      tool('seatmap_validate_spec').run(
        { spec: SPEC, path: 'x.json' },
        contextFor('http://localhost:8080'),
      ),
    ).rejects.toThrow(/not both/);
  });

  it('rejects neither a spec nor a path', async () => {
    await expect(
      tool('seatmap_validate_spec').run({}, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/one of/);
  });

  it('refuses to read the spec from stdin', async () => {
    await expect(
      tool('seatmap_validate_spec').run({ path: '-' }, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/transport/);
  });

  it('refuses a JavaScript module spec', async () => {
    await expect(
      tool('seatmap_validate_spec').run({ path: 'spec.mjs' }, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/JSON specs/);
  });

  it('reports a spec that fails validation', async () => {
    await expect(
      tool('seatmap_validate_spec').run(
        { spec: { schema: {} } },
        contextFor('http://localhost:8080'),
      ),
    ).rejects.toThrow();
  });
});

describe('seatmap_build', () => {
  it('refuses a production target even with writes allowed', async () => {
    const calls: ClientCall[] = [];
    await expect(
      tool('seatmap_build').run(
        { spec: SPEC, venueId: 1 },
        contextFor('https://editor.seatmap.pro', { allowWrite: true, client: stubClient(calls) }),
      ),
    ).rejects.toThrow(RefusedError);
    expect(calls).toEqual([]);
  });

  it('compiles without writing when dryRun is set', async () => {
    const calls: ClientCall[] = [];
    const result = (await tool('seatmap_build').run(
      { spec: SPEC, dryRun: true },
      contextFor('https://editor.seatmap.pro', { allowWrite: true, client: stubClient(calls) }),
    )) as { applied: boolean };

    expect(result.applied).toBe(false);
    expect(calls).toEqual([]);
  });

  it('creates a schema and pushes the compiled seatmap', async () => {
    const calls: ClientCall[] = [];
    const client = stubClient(calls, {
      'POST /api/venues/12/schemas/': { id: 77, name: 'Inline Hall' },
    });

    const result = (await tool('seatmap_build').run(
      { spec: SPEC, venueId: 12 },
      contextFor('http://localhost:8080', { allowWrite: true, client }),
    )) as { applied: boolean; schemaId: number; schemaCreated: boolean; venueCreated: boolean };

    expect(result).toMatchObject({
      applied: true,
      venueId: 12,
      venueCreated: false,
      schemaId: 77,
      schemaCreated: true,
    });
    expect(calls).toEqual([
      { method: 'POST', path: '/api/venues/12/schemas/' },
      { method: 'PUT', path: '/api/seatmap/77/' },
    ]);
  });

  it('pushes into an existing schema only when it is empty', async () => {
    const calls: ClientCall[] = [];
    const client = stubClient(calls, {
      'GET /api/seatmap/5/': { sectors: [], rows: [], seats: [] },
    });
    const result = (await tool('seatmap_build').run(
      { spec: SPEC, venueId: 12, schemaId: 5 },
      contextFor('http://localhost:8080', { allowWrite: true, client }),
    )) as { schemaCreated: boolean };

    expect(result.schemaCreated).toBe(false);
    expect(calls).toEqual([
      { method: 'GET', path: '/api/seatmap/5/' },
      { method: 'PUT', path: '/api/seatmap/5/' },
    ]);
  });

  it('refuses to build into a schema that already holds a seatmap', async () => {
    const calls: ClientCall[] = [];
    const client = stubClient(calls, {
      'GET /api/seatmap/5/': {
        sectors: [{ guid: 'a', name: 'A', ga: false, x: 0, y: 0 }],
        rows: [{ guid: 'r' }],
        seats: [{ guid: 's' }],
      },
    });

    await expect(
      tool('seatmap_build').run(
        { spec: SPEC, venueId: 12, schemaId: 5 },
        contextFor('http://localhost:8080', { allowWrite: true, client }),
      ),
    ).rejects.toThrow(/already holds/);

    expect(calls).toEqual([{ method: 'GET', path: '/api/seatmap/5/' }]);
  });

  it('does not create a venue when the schema is given explicitly', async () => {
    const calls: ClientCall[] = [];
    const client = stubClient(calls, {
      'GET /api/seatmap/5/': { sectors: [], rows: [], seats: [] },
    });

    await tool('seatmap_build').run(
      { spec: SPEC, schemaId: 5 },
      contextFor('http://localhost:8080', { allowWrite: true, client }),
    );

    expect(calls.some((call) => call.path === '/api/venues/')).toBe(false);
  });

  it('needs a venue when the spec carries none', async () => {
    await expect(
      tool('seatmap_build').run(
        { spec: SPEC },
        contextFor('http://localhost:8080', { allowWrite: true }),
      ),
    ).rejects.toThrow(/No venue specified/);
  });

  it('rejects a non-numeric venueId', async () => {
    await expect(
      tool('seatmap_build').run(
        { spec: SPEC, venueId: 'twelve' },
        contextFor('http://localhost:8080', { allowWrite: true }),
      ),
    ).rejects.toThrow(/must be a whole number/);
  });
});

describe('seatmap_session', () => {
  it('reports the target, the production verdict and the write mode', async () => {
    const result = (await tool('seatmap_session').run(
      {},
      contextFor('https://editor.seatmap.pro'),
    )) as { production: boolean; writesEnabled: boolean; user: { email: string } | null };

    expect(result.production).toBe(true);
    expect(result.writesEnabled).toBe(false);
    expect(result.user).toEqual({ email: 'ops@example.test' });
  });

  it('skips the user lookup when no token is stored', async () => {
    const calls: ClientCall[] = [];
    const context = contextFor('http://localhost:8080', { client: stubClient(calls) });
    context.target = { ...context.target, token: undefined };

    const result = (await tool('seatmap_session').run({}, context)) as {
      authenticated: boolean;
      user: unknown;
    };

    expect(result.authenticated).toBe(false);
    expect(result.user).toBeNull();
  });
});

describe('read tools', () => {
  it('lists venues through the paged endpoint', async () => {
    const calls: ClientCall[] = [];
    const client = stubClient(calls, {
      'GET /api/venues/': { content: [{ id: 1, name: 'Hall' }], totalElements: 1 },
    });

    const result = (await tool('seatmap_list_venues').run(
      { search: 'Hall' },
      contextFor('http://localhost:8080', { client }),
    )) as { total: number; venues: Array<{ id: number }> };

    expect(result.total).toBe(1);
    expect(result.venues[0]?.id).toBe(1);
    expect(calls).toEqual([{ method: 'GET', path: '/api/venues/' }]);
  });

  it('summarizes a persisted seatmap as counts', async () => {
    const calls: ClientCall[] = [];
    const client = stubClient(calls, {
      'GET /api/seatmap/9/': {
        sectors: [
          { guid: 'a', name: 'A', ga: false, x: 0, y: 0 },
          { guid: 'b', name: 'B', ga: true, x: 0, y: 0 },
        ],
        rows: [{ guid: 'r' }],
        seats: [{ guid: 's' }, { guid: 't' }],
        shapes: [],
      },
    });

    const result = await tool('seatmap_schema_summary').run(
      { schemaId: 9 },
      contextFor('http://localhost:8080', { client }),
    );

    expect(result).toMatchObject({
      schemaId: 9,
      sections: 2,
      gaSections: 1,
      rows: 1,
      seats: 2,
      shapes: 0,
      hasVectorBackground: false,
    });
  });

  it('requires a schema id to summarize', async () => {
    await expect(
      tool('seatmap_schema_summary').run({}, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/required/);
  });
});

describe('argument validation', () => {
  it('rejects a zero or negative page size', async () => {
    await expect(
      tool('seatmap_list_venues').run({ limit: 0 }, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/at least 1/);
  });

  it('rejects a fractional page size', async () => {
    await expect(
      tool('seatmap_list_venues').run({ limit: 12.7 }, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/whole number/);
  });

  it('rejects a negative page index', async () => {
    await expect(
      tool('seatmap_list_venues').run({ page: -3 }, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/must not be negative/);
  });

  it('rejects a non-positive id', async () => {
    await expect(
      tool('seatmap_schema_summary').run({ schemaId: 0 }, contextFor('http://localhost:8080')),
    ).rejects.toThrow(/positive id/);
  });

  it('treats an empty path as present, not absent', async () => {
    await expect(
      tool('seatmap_validate_spec').run(
        { path: '', spec: SPEC },
        contextFor('http://localhost:8080'),
      ),
    ).rejects.toThrow(/not both/);
  });
});

describe('filesystem containment', () => {
  it('refuses an underlay that escapes the working directory', async () => {
    await expect(
      tool('seatmap_validate_spec').run(
        { spec: { ...SPEC, underlay: { file: '/etc/hosts', width: 100 } } },
        contextFor('http://localhost:8080'),
      ),
    ).rejects.toThrow(/refused/);
  });

  it('refuses a spec path that escapes the working directory', async () => {
    await expect(
      tool('seatmap_validate_spec').run(
        { path: '../../../etc/hosts' },
        contextFor('http://localhost:8080'),
      ),
    ).rejects.toThrow(/refused/);
  });
});

describe('seatmap_schema_summary background detection', () => {
  it('reports no background when the service sends an explicit null', async () => {
    const client = stubClient([], {
      'GET /api/seatmap/9/': {
        sectors: [],
        rows: [],
        seats: [],
        shapes: [],
        vectorBackground: null,
      },
    });

    const result = (await tool('seatmap_schema_summary').run(
      { schemaId: 9 },
      contextFor('http://localhost:8080', { client }),
    )) as { hasVectorBackground: boolean };

    expect(result.hasVectorBackground).toBe(false);
  });
});
