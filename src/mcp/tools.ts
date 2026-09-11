import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ApiClient } from '../api/client.js';
import { isEmpty, resolveSchema, resolveVenue, seatmapSize } from '../api/resolve.js';
import type { EventDTO, Page, SchemaDTO, SeatmapDTO, VenueDTO } from '../api/types.js';
import { assertMutationAllowed, isProductionTarget } from '../config/guards.js';
import { CliError } from '../cli/errors.js';
import type { ResolvedTarget } from '../config/profiles.js';
import { compileSpec } from '../schema/compile.js';
import { loadUnderlay, readSpecFile, STDIN_PATH } from '../schema/load.js';
import { parseSpec } from '../schema/spec.js';
import type { BuildSpec } from '../schema/spec.js';
import { INVALID_PARAMS, RpcError } from './protocol.js';

export interface McpContext {
  client: ApiClient;
  target: ResolvedTarget;
  allowWrite: boolean;
  cwd: string;
}

export interface JsonSchemaProperty {
  type: string;
  description: string;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  mutating: boolean;
  authOptional?: boolean;
  run: (args: Record<string, unknown>, context: McpContext) => Promise<unknown>;
}

function present(args: Record<string, unknown>, name: string): boolean {
  const value = args[name];
  return value !== undefined && value !== null;
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  if (!present(args, name)) return undefined;
  const value = args[name];
  if (typeof value !== 'string') {
    throw new RpcError(INVALID_PARAMS, `"${name}" must be a string`);
  }
  if (value.length === 0) {
    throw new RpcError(INVALID_PARAMS, `"${name}" must not be empty; omit it instead`);
  }
  return value;
}

function optionalInteger(args: Record<string, unknown>, name: string): number | undefined {
  if (!present(args, name)) return undefined;
  const value = args[name];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RpcError(INVALID_PARAMS, `"${name}" must be a whole number`);
  }
  return value;
}

function requireId(args: Record<string, unknown>, name: string): number {
  const value = optionalInteger(args, name);
  if (value === undefined) throw new RpcError(INVALID_PARAMS, `"${name}" is required`);
  if (value <= 0) throw new RpcError(INVALID_PARAMS, `"${name}" must be a positive id`);
  return value;
}

function optionalId(args: Record<string, unknown>, name: string): number | undefined {
  const value = optionalInteger(args, name);
  if (value === undefined) return undefined;
  if (value <= 0) throw new RpcError(INVALID_PARAMS, `"${name}" must be a positive id`);
  return value;
}

function pageSize(args: Record<string, unknown>, fallback: number): number {
  const value = optionalInteger(args, 'limit');
  if (value === undefined) return fallback;
  if (value < 1) throw new RpcError(INVALID_PARAMS, '"limit" must be at least 1');
  return value;
}

function pageIndex(args: Record<string, unknown>): number {
  const value = optionalInteger(args, 'page');
  if (value === undefined) return 0;
  if (value < 0) throw new RpcError(INVALID_PARAMS, '"page" must not be negative');
  return value;
}

function optionalBoolean(args: Record<string, unknown>, name: string): boolean {
  if (!present(args, name)) return false;
  const value = args[name];
  if (typeof value !== 'boolean') {
    throw new RpcError(INVALID_PARAMS, `"${name}" must be a boolean`);
  }
  return value;
}

async function resolveSpec(
  args: Record<string, unknown>,
  context: McpContext,
): Promise<{ spec: BuildSpec; source: string }> {
  const hasPath = present(args, 'path');
  const hasInline = present(args, 'spec');

  if (hasPath && hasInline) {
    throw new RpcError(INVALID_PARAMS, 'Pass either "spec" or "path", not both');
  }
  if (!hasPath && !hasInline) {
    throw new RpcError(INVALID_PARAMS, 'Pass one of "spec" or "path"');
  }

  const root = context.cwd;

  if (hasPath) {
    const path = optionalString(args, 'path') as string;
    if (path === STDIN_PATH) {
      throw new RpcError(INVALID_PARAMS, 'stdin is the MCP transport and cannot carry a spec');
    }
    const absolute = isAbsolute(path) ? path : resolvePath(root, path);
    const raw = await readSpecFile(absolute, { containWithin: root });
    return {
      spec: loadUnderlay(parseSpec(raw), absolute, { containWithin: root }),
      source: absolute,
    };
  }

  return {
    spec: loadUnderlay(parseSpec(args['spec']), 'inline', {
      baseDir: root,
      containWithin: root,
    }),
    source: 'inline',
  };
}

function summarizeSpec(spec: BuildSpec): Record<string, unknown> {
  const compiled = compileSpec(spec);
  const background = compiled.seatmap.vectorBackground;
  return {
    schemaName: spec.schema.name,
    venueName: spec.venue?.name ?? null,
    stats: compiled.stats,
    underlay: background
      ? {
          width: background.width,
          height: background.height,
          x: background.x,
          y: background.y,
          scale: background.scale,
          bytes: background.backgroundSvg.length,
        }
      : null,
  };
}

const SPEC_PROPERTIES: Record<string, JsonSchemaProperty> = {
  spec: {
    type: 'object',
    description: 'The build spec inline. Mutually exclusive with "path".',
  },
  path: {
    type: 'string',
    description:
      'Path to a JSON spec file, absolute or relative to the working directory the server was started in. JavaScript module specs are rejected here.',
  },
};

const SEARCH_PROPERTY: JsonSchemaProperty = {
  type: 'string',
  description: 'Case-insensitive name filter.',
};

const LIMIT_PROPERTY: JsonSchemaProperty = {
  type: 'number',
  description: 'Maximum rows to return. Defaults to 50.',
};

const PAGE_PROPERTY: JsonSchemaProperty = {
  type: 'number',
  description: 'Zero-based page index. Defaults to 0.',
};

const PAGE_PROPERTIES: Record<string, JsonSchemaProperty> = {
  search: SEARCH_PROPERTY,
  limit: LIMIT_PROPERTY,
  page: PAGE_PROPERTY,
};

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'seatmap_session',
    title: 'Describe the session',
    description:
      'Report which editor instance this server talks to, which stored profile it uses, whether that target counts as production, and whether write tools are enabled.',
    inputSchema: { type: 'object', properties: {} },
    mutating: false,
    authOptional: true,
    run: async (_args, context) => {
      const session = {
        profile: context.target.profileName,
        baseUrl: context.target.baseUrl,
        orgId: context.target.orgId ?? null,
        production: isProductionTarget(context.target.baseUrl),
        authenticated: context.target.token !== undefined,
        writesEnabled: context.allowWrite,
      };
      if (context.target.token === undefined) return { ...session, user: null };
      const response = await context.client.currentUser();
      return { ...session, user: response.user ?? null };
    },
  },
  {
    name: 'seatmap_list_venues',
    title: 'List venues',
    description: 'List the venues visible to the current session, newest page first.',
    inputSchema: { type: 'object', properties: PAGE_PROPERTIES },
    mutating: false,
    run: async (args, context) => {
      const page = await context.client.getJson<Page<VenueDTO>>('/api/venues/', {
        query: {
          search: optionalString(args, 'search'),
          size: pageSize(args, 50),
          page: pageIndex(args),
        },
      });
      return { total: page.totalElements ?? null, venues: page.content ?? [] };
    },
  },
  {
    name: 'seatmap_list_schemas',
    title: 'List schemas in a venue',
    description: 'List the seating schemas that belong to one venue.',
    inputSchema: {
      type: 'object',
      properties: {
        venueId: { type: 'number', description: 'Venue to list schemas for.' },
        search: SEARCH_PROPERTY,
        limit: { type: 'number', description: 'Maximum rows to return. Defaults to 100.' },
      },
      required: ['venueId'],
    },
    mutating: false,
    run: async (args, context) => {
      const venueId = requireId(args, 'venueId');
      const page = await context.client.getJson<Page<SchemaDTO>>(
        `/api/venues/${venueId}/schemas/`,
        {
          query: {
            search: optionalString(args, 'search'),
            size: pageSize(args, 100),
          },
        },
      );
      return { venueId, total: page.totalElements ?? null, schemas: page.content ?? [] };
    },
  },
  {
    name: 'seatmap_get_schema',
    title: 'Show one schema',
    description: 'Fetch the metadata of a single schema: name, draft state, seat counts.',
    inputSchema: {
      type: 'object',
      properties: {
        venueId: { type: 'number', description: 'Venue that owns the schema.' },
        schemaId: { type: 'number', description: 'Schema to fetch.' },
      },
      required: ['venueId', 'schemaId'],
    },
    mutating: false,
    run: async (args, context) => {
      const venueId = requireId(args, 'venueId');
      const schemaId = requireId(args, 'schemaId');
      return context.client.getJson<SchemaDTO>(`/api/venues/${venueId}/schemas/${schemaId}`);
    },
  },
  {
    name: 'seatmap_schema_summary',
    title: 'Summarize a persisted seatmap',
    description:
      'Count the sections, rows, seats and shapes stored against a schema, and report its view box. Returns counts rather than the seatmap itself, which can be megabytes.',
    inputSchema: {
      type: 'object',
      properties: { schemaId: { type: 'number', description: 'Schema to summarize.' } },
      required: ['schemaId'],
    },
    mutating: false,
    run: async (args, context) => {
      const schemaId = requireId(args, 'schemaId');
      const seatmap = await context.client.getJson<SeatmapDTO>(`/api/seatmap/${schemaId}/`);
      const sectors = seatmap.sectors ?? [];
      return {
        schemaId,
        sections: sectors.length,
        gaSections: sectors.filter((sector) => sector.ga === true).length,
        rows: (seatmap.rows ?? []).length,
        seats: (seatmap.seats ?? []).length,
        shapes: (seatmap.shapes ?? []).length,
        hasVectorBackground:
          seatmap.vectorBackground !== undefined && seatmap.vectorBackground !== null,
        clientViewBox: seatmap.clientViewBox ?? null,
      };
    },
  },
  {
    name: 'seatmap_list_events',
    title: 'List events',
    description: 'List events visible to the current session, optionally filtered by schema.',
    inputSchema: {
      type: 'object',
      properties: {
        schemaId: { type: 'number', description: 'Only events on this schema.' },
        venueId: { type: 'number', description: 'Only events at this venue.' },
        status: { type: 'string', description: 'Only events in this status.' },
        search: SEARCH_PROPERTY,
        limit: LIMIT_PROPERTY,
      },
    },
    mutating: false,
    run: async (args, context) => {
      const page = await context.client.getJson<Page<EventDTO>>('/api/events', {
        query: {
          schemaId: optionalId(args, 'schemaId'),
          venueId: optionalId(args, 'venueId'),
          status: optionalString(args, 'status'),
          search: optionalString(args, 'search'),
          size: pageSize(args, 50),
        },
      });
      return { total: page.totalElements ?? null, events: page.content ?? [] };
    },
  },
  {
    name: 'seatmap_validate_spec',
    title: 'Validate and compile a spec',
    description:
      'Validate a build spec and compile it to a seatmap payload without contacting the editor service. Returns per-section row and seat counts. Use this to check a spec before building it.',
    inputSchema: { type: 'object', properties: SPEC_PROPERTIES },
    mutating: false,
    authOptional: true,
    run: async (args, context) => {
      const { spec, source } = await resolveSpec(args, context);
      return { source, ...summarizeSpec(spec) };
    },
  },
  {
    name: 'seatmap_build',
    title: 'Build a schema from a spec',
    description:
      'Compile a build spec and push it to the editor service, creating the venue and schema when they do not exist. Requires the server to be started with --allow-write, and always refuses a production target.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SPEC_PROPERTIES,
        venueId: { type: 'number', description: 'Push into this venue instead of the spec venue.' },
        schemaId: {
          type: 'number',
          description: 'Push into this existing schema instead of creating one.',
        },
        name: { type: 'string', description: 'Override the schema name from the spec.' },
        dryRun: {
          type: 'boolean',
          description: 'Compile and report without writing anything. Defaults to false.',
        },
      },
    },
    mutating: true,
    authOptional: true,
    run: async (args, context) => {
      const { spec, source } = await resolveSpec(args, context);

      if (optionalBoolean(args, 'dryRun')) {
        return { source, applied: false, ...summarizeSpec(spec) };
      }

      context.client.requireAuth();
      assertMutationAllowed({
        baseUrl: context.target.baseUrl,
        action: `build schema "${spec.schema.name}"`,
        force: false,
      });

      const compiled = compileSpec(spec);
      const explicitSchema = optionalId(args, 'schemaId');

      if (explicitSchema !== undefined) {
        const existing = await seatmapSize(context.client, explicitSchema);
        if (!isEmpty(existing)) {
          throw new CliError(
            `Schema ${explicitSchema} already holds ${existing.sectors} sections, ` +
              `${existing.rows} rows and ${existing.seats} seats.`,
            1,
            'The service matches rows and seats by numeric id, so a second build would ' +
              'duplicate them instead of replacing them. Build into a new schema, or run ' +
              '"seatmap build --schema <id> --replace" from a terminal.',
          );
        }
      }

      const venue =
        explicitSchema === undefined
          ? await resolveVenue(
              context.client,
              spec,
              optionalId(args, 'venueId'),
              'Pass "venueId", or give the spec a "venue" block.',
            )
          : { id: optionalId(args, 'venueId'), created: false };

      const schema = await resolveSchema(
        context.client,
        spec,
        venue.id ?? 0,
        explicitSchema,
        optionalString(args, 'name'),
      );

      await context.client.putJson<SeatmapDTO>(`/api/seatmap/${schema.id}/`, compiled.seatmap);

      return {
        source,
        applied: true,
        venueId: venue.id ?? null,
        venueCreated: venue.created,
        schemaId: schema.id,
        schemaCreated: schema.created,
        stats: compiled.stats,
      };
    },
  },
];

export function availableTools(allowWrite: boolean): readonly ToolDefinition[] {
  return allowWrite ? TOOLS : TOOLS.filter((tool) => !tool.mutating);
}

export function findTool(name: string, allowWrite: boolean): ToolDefinition {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new RpcError(INVALID_PARAMS, `Unknown tool "${name}"`);
  if (tool.mutating && !allowWrite) {
    throw new RpcError(
      INVALID_PARAMS,
      `"${name}" writes to the editor service and this server was started read-only. Restart it with --allow-write.`,
    );
  }
  return tool;
}
