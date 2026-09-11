import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  boolOption,
  numberOption,
  positional,
  positionalNumber,
  requiredString,
  stringOption,
} from '../cli/args.js';
import { confirm } from '../cli/confirm.js';
import { CliError, EXIT_FAILURE, UsageError, describeError } from '../cli/errors.js';
import { emitJson, info, isJsonMode, output, success } from '../cli/output.js';
import { assertMutationAllowed } from '../config/guards.js';
import { authenticatedContext } from './context.js';
import type { MoveResult, Page, SchemaDTO, SeatmapDTO } from '../api/types.js';

const LIST_OPTIONS = {
  venue: { type: 'string' as const },
  search: { type: 'string' as const },
  limit: { type: 'string' as const },
  draft: { type: 'boolean' as const },
};

const CREATE_OPTIONS = {
  venue: { type: 'string' as const },
  name: { type: 'string' as const },
  description: { type: 'string' as const },
  draft: { type: 'boolean' as const },
};

const RENAME_OPTIONS = {
  venue: { type: 'string' as const },
  name: { type: 'string' as const },
  'ga-capacity': { type: 'string' as const },
  publish: { type: 'boolean' as const },
  draft: { type: 'boolean' as const },
};

const EXPORT_OPTIONS = {
  out: { type: 'string' as const },
};

const TRANSFER_OPTIONS = {
  'source-org': { type: 'string' as const },
  'target-org': { type: 'string' as const },
  'to-venue': { type: 'string' as const },
};

const MOVE_OPTIONS = {
  'to-venue': { type: 'string' as const },
};

function requireVenue(value: number | undefined): number {
  if (value === undefined) {
    throw new UsageError('--venue <id> is required', 'Find venue ids with "seatmap venues list".');
  }
  return value;
}

async function listSchemas(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);
  const venueId = requireVenue(numberOption(context.values, 'venue'));

  const page = await context.client.getJson<Page<SchemaDTO>>(`/api/venues/${venueId}/schemas/`, {
    query: {
      search: stringOption(context.values, 'search'),
      size: numberOption(context.values, 'limit') ?? 100,
      isDraft: boolOption(context.values, 'draft') ? true : undefined,
    },
  });

  output(page.content ?? [], [
    { header: 'ID', value: (schema) => String(schema.id) },
    { header: 'NAME', value: (schema) => schema.name },
    { header: 'DRAFT', value: (schema) => (schema.draft ? 'yes' : 'no') },
    { header: 'GA CAPACITY', value: (schema) => String(schema.gaCapacity ?? '') },
  ]);
}

async function showSchema(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);
  const venueId = requireVenue(numberOption(context.values, 'venue'));
  const schemaId = positionalNumber(context.positionals, 1, 'schemaId');

  const schema = await context.client.getJson<SchemaDTO>(
    `/api/venues/${venueId}/schemas/${schemaId}`,
  );

  if (isJsonMode()) {
    emitJson(schema);
    return;
  }

  info(`ID           ${schema.id}`);
  info(`Name         ${schema.name}`);
  info(`Draft        ${schema.draft ? 'yes' : 'no'}`);
  if (schema.description) info(`Description  ${schema.description}`);
  if (schema.gaCapacity != null) info(`GA capacity  ${schema.gaCapacity}`);
}

async function createSchema(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, CREATE_OPTIONS);
  const venueId = requireVenue(numberOption(context.values, 'venue'));

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `create a schema in venue ${venueId}`,
    force: context.force,
  });

  const schema = await context.client.postJson<SchemaDTO>(`/api/venues/${venueId}/schemas/`, {
    name: requiredString(context.values, 'name'),
    description: stringOption(context.values, 'description'),
    draft: boolOption(context.values, 'draft'),
  });

  if (isJsonMode()) {
    emitJson(schema);
    return;
  }
  success(`Created schema ${schema.id} "${schema.name}" in venue ${venueId}`);
}

async function renameSchema(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, RENAME_OPTIONS);
  const venueId = requireVenue(numberOption(context.values, 'venue'));
  const schemaId = positionalNumber(context.positionals, 1, 'schemaId');

  const publish = boolOption(context.values, 'publish');
  const draft = boolOption(context.values, 'draft');
  if (publish && draft) {
    throw new UsageError('Pass at most one of --publish or --draft');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `rename schema ${schemaId}`,
    force: context.force,
  });

  const current = await context.client.getJson<SchemaDTO>(
    `/api/venues/${venueId}/schemas/${schemaId}`,
  );

  const updated = await context.client.putJson<SchemaDTO>(`/api/venues/${venueId}/schemas/`, {
    id: schemaId,
    name: stringOption(context.values, 'name') ?? current.name,
    gaCapacity: numberOption(context.values, 'ga-capacity') ?? current.gaCapacity,
    draft: publish ? false : draft ? true : current.draft,
    bitmapBackground: current.bitmapBackground,
    numberingDefaults: current.numberingDefaults,
  });

  if (isJsonMode()) {
    emitJson(updated);
    return;
  }
  success(`Schema ${schemaId} is now "${updated.name}" (${updated.draft ? 'draft' : 'published'})`);
}

async function deleteSchema(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);
  const venueId = requireVenue(numberOption(context.values, 'venue'));
  const schemaIds = context.positionals
    .slice(1)
    .map((_, index) => positionalNumber(context.positionals, index + 1, 'schemaId'));
  if (schemaIds.length === 0) {
    throw new UsageError('At least one <schemaId> is required');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `delete ${schemaIds.length} schema(s) from venue ${venueId}`,
    force: context.force,
  });

  const schemas = await Promise.all(
    schemaIds.map((id) =>
      context.client.getJson<SchemaDTO>(`/api/venues/${venueId}/schemas/${id}`),
    ),
  );
  const listing = schemas.map((schema) => `  ${schema.id} "${schema.name}"`).join('\n');
  await confirm({
    question: `Delete these ${schemaIds.length} schemas from venue ${venueId} on ${context.target.baseUrl}?\n${listing}`,
    assumeYes: context.yes,
  });

  const outcomes: DeleteOutcome[] = [];
  for (const id of schemaIds) {
    try {
      await context.client.delete(`/api/venues/${venueId}/schemas/`, { query: { id } });
      outcomes.push({ id, deleted: true });
      info(`  deleted schema ${id}`);
    } catch (error) {
      outcomes.push({ id, deleted: false, error: describeError(error) });
    }
  }

  const failed = outcomes.filter((row) => !row.deleted);
  if (isJsonMode()) {
    emitJson(outcomes);
  } else {
    for (const row of failed) info(`  schema ${row.id} FAILED: ${row.error ?? ''}`);
    success(
      `Deleted ${outcomes.length - failed.length}/${outcomes.length} schema(s) from venue ${venueId}`,
    );
  }
  if (failed.length > 0) {
    throw new CliError(
      `${failed.length} of ${outcomes.length} schema deletions failed`,
      EXIT_FAILURE,
    );
  }
}

async function exportSeatmap(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, EXPORT_OPTIONS);
  const schemaId = positionalNumber(context.positionals, 1, 'schemaId');

  const seatmap = await context.client.getJson<SeatmapDTO>(`/api/seatmap/${schemaId}/`);
  const serialized = `${JSON.stringify(seatmap, null, 2)}\n`;

  const out = stringOption(context.values, 'out');
  if (out) {
    writeFileSync(out, serialized);
    success(
      `Wrote ${seatmap.sectors?.length ?? 0} sections / ${seatmap.seats?.length ?? 0} seats to ${out}`,
    );
    return;
  }

  process.stdout.write(serialized);
}

async function exportSmp(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, EXPORT_OPTIONS);
  const schemaId = positionalNumber(context.positionals, 1, 'schemaId');
  const out = requiredString(context.values, 'out');

  const bytes = await context.client.getBytes(`/api/export/${schemaId}/json/`, { accept: '*/*' });
  writeFileSync(out, bytes);
  success(`Wrote ${bytes.length} bytes of schema ${schemaId} to ${out}`);
}

async function importSmp(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);
  const venueId = requireVenue(numberOption(context.values, 'venue'));
  const file = positional(context.positionals, 1, 'file');

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `import ${file} into venue ${venueId}`,
    force: context.force,
  });

  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)]), basename(file));

  await context.client.postForm(`/api/venues/${venueId}/import/`, form);
  success(`Imported ${file} into venue ${venueId}`);
}

async function moveSchema(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, MOVE_OPTIONS);
  const schemaId = positionalNumber(context.positionals, 1, 'schemaId');
  const targetVenue = numberOption(context.values, 'to-venue');
  if (targetVenue === undefined) {
    throw new UsageError('--to-venue <id> is required');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `move schema ${schemaId} to venue ${targetVenue}`,
    force: context.force,
  });

  const result = await context.client.postJson<MoveResult>(
    `/api/admin/schemas/${schemaId}/move`,
    { venueId: targetVenue },
    { withOrg: false },
  );

  if (isJsonMode()) {
    emitJson(result);
    return;
  }
  success(
    `Moved schema ${schemaId} to venue ${targetVenue}` +
      (result.fromOrganizationId === result.toOrganizationId
        ? ''
        : ` (organization ${result.fromOrganizationId} -> ${result.toOrganizationId}, ${result.movedEvents} events)`),
  );
}

interface DeleteOutcome {
  id: number;
  deleted: boolean;
  error?: string;
}

interface TransferOutcome {
  schemaId: number;
  imported: boolean;
  bytes?: number;
  error?: string;
}

async function transferSchemas(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, TRANSFER_OPTIONS);
  const schemaIds = context.positionals
    .slice(1)
    .map((_, index) => positionalNumber(context.positionals, index + 1, 'schemaId'));
  if (schemaIds.length === 0) {
    throw new UsageError('At least one <schemaId> is required');
  }

  const sourceOrg = numberOption(context.values, 'source-org');
  const targetOrg = numberOption(context.values, 'target-org');
  const targetVenue = numberOption(context.values, 'to-venue');
  if (targetVenue === undefined) {
    throw new UsageError('--to-venue <id> is required');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `transfer ${schemaIds.length} schema(s) into venue ${targetVenue}`,
    force: context.force,
  });

  const outcomes: TransferOutcome[] = [];
  for (const schemaId of schemaIds) {
    try {
      const bytes = await context.client.getBytes(`/api/export/${schemaId}/json/`, {
        accept: '*/*',
        withOrg: sourceOrg === undefined,
        query: { orgId: sourceOrg },
      });
      const form = new FormData();
      form.append('file', new Blob([bytes]), `${schemaId}.smp`);
      await context.client.postForm(`/api/venues/${targetVenue}/import/`, form, {
        withOrg: targetOrg === undefined,
        query: { orgId: targetOrg },
      });
      outcomes.push({ schemaId, imported: true, bytes: bytes.length });
      info(`  schema ${schemaId} -> venue ${targetVenue} (${bytes.length} bytes)`);
    } catch (error) {
      outcomes.push({ schemaId, imported: false, error: describeError(error) });
    }
  }

  const failed = outcomes.filter((row) => !row.imported);
  if (isJsonMode()) {
    emitJson(outcomes);
  } else {
    for (const row of failed) info(`  schema ${row.schemaId} FAILED: ${row.error ?? ''}`);
    success(
      `Transferred ${outcomes.length - failed.length}/${outcomes.length} schemas into venue ${targetVenue}`,
    );
  }
  if (failed.length > 0) {
    throw new CliError(
      `${failed.length} of ${outcomes.length} schema transfers failed`,
      EXIT_FAILURE,
    );
  }
}

export async function schemasCommand(argv: readonly string[]): Promise<void> {
  const sub = argv[0] ?? 'list';
  switch (sub) {
    case 'list':
      return listSchemas(argv.slice(1));
    case 'show':
      return showSchema(argv);
    case 'create':
      return createSchema(argv.slice(1));
    case 'rename':
      return renameSchema(argv);
    case 'delete':
      return deleteSchema(argv);
    case 'export':
      return exportSeatmap(argv);
    case 'export-smp':
      return exportSmp(argv);
    case 'import':
      return importSmp(argv);
    case 'transfer':
      return transferSchemas(argv);
    case 'move':
      return moveSchema(argv);
    default:
      throw new UsageError(
        `Unknown subcommand "seatmap schemas ${sub}"`,
        'Available: list, show, create, rename, delete, export, export-smp, import, transfer, move',
      );
  }
}
