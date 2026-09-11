import { numberOption, positionalNumber, requiredString, stringOption } from '../cli/args.js';
import { confirm } from '../cli/confirm.js';
import { CliError, EXIT_FAILURE, UsageError, describeError } from '../cli/errors.js';
import { emitJson, info, isJsonMode, output, success } from '../cli/output.js';
import { assertMutationAllowed } from '../config/guards.js';
import { authenticatedContext } from './context.js';
import type { MoveResult, Page, VenueDTO } from '../api/types.js';

const LIST_OPTIONS = {
  search: { type: 'string' as const },
  limit: { type: 'string' as const },
  page: { type: 'string' as const },
};

const CREATE_OPTIONS = {
  name: { type: 'string' as const },
  address: { type: 'string' as const },
  lat: { type: 'string' as const },
  lng: { type: 'string' as const },
};

interface DeleteOutcome {
  id: number;
  deleted: boolean;
  error?: string;
}

const MOVE_OPTIONS = {
  'to-org': { type: 'string' as const },
};

async function listVenues(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);

  const page = await context.client.getJson<Page<VenueDTO>>('/api/venues/', {
    query: {
      search: stringOption(context.values, 'search'),
      size: numberOption(context.values, 'limit') ?? 50,
      page: numberOption(context.values, 'page') ?? 0,
    },
  });

  output(page.content ?? [], [
    { header: 'ID', value: (venue) => String(venue.id) },
    { header: 'NAME', value: (venue) => venue.name },
    { header: 'ADDRESS', value: (venue) => venue.address ?? '' },
  ]);
}

async function createVenue(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, CREATE_OPTIONS);
  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: 'create a venue',
    force: context.force,
  });

  const venue = await context.client.postJson<VenueDTO>('/api/venues/', {
    name: requiredString(context.values, 'name'),
    address: stringOption(context.values, 'address'),
    lat: numberOption(context.values, 'lat'),
    lng: numberOption(context.values, 'lng'),
  });

  if (isJsonMode()) {
    emitJson(venue);
    return;
  }
  success(`Created venue ${venue.id} "${venue.name}"`);
}

async function renameVenue(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, CREATE_OPTIONS);
  const id = positionalNumber(context.positionals, 1, 'venueId');

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `rename venue ${id}`,
    force: context.force,
  });

  const current = await context.client.getJson<VenueDTO>(`/api/venues/${id}`);
  const updated = await context.client.putJson<VenueDTO>('/api/venues/', {
    id,
    name: stringOption(context.values, 'name') ?? current.name,
    address: stringOption(context.values, 'address') ?? current.address ?? '',
    lat: numberOption(context.values, 'lat') ?? current.lat,
    lng: numberOption(context.values, 'lng') ?? current.lng,
  });

  if (isJsonMode()) {
    emitJson(updated);
    return;
  }
  success(`Venue ${id} is now "${updated.name}" at "${updated.address ?? ''}"`);
}

async function showVenue(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv);
  const id = positionalNumber(context.positionals, 1, 'venueId');
  const venue = await context.client.getJson<VenueDTO>(`/api/venues/${id}`);

  if (isJsonMode()) {
    emitJson(venue);
    return;
  }
  output(
    [venue],
    [
      { header: 'ID', value: (row) => String(row.id) },
      { header: 'NAME', value: (row) => row.name },
      { header: 'ADDRESS', value: (row) => row.address ?? '' },
      { header: 'LAT', value: (row) => (row.lat == null ? '' : String(row.lat)) },
      { header: 'LNG', value: (row) => (row.lng == null ? '' : String(row.lng)) },
    ],
  );
}

async function moveVenue(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, MOVE_OPTIONS);
  const venueId = positionalNumber(context.positionals, 1, 'venueId');
  const targetOrg = numberOption(context.values, 'to-org');
  if (targetOrg === undefined) {
    throw new UsageError('--to-org <id> is required');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `move venue ${venueId} to organization ${targetOrg}`,
    force: context.force,
  });

  const venue = await context.client.getJson<VenueDTO>(`/api/venues/${venueId}`);
  await confirm({
    question: `Move venue ${venueId} "${venue.name}" and every schema under it to organization ${targetOrg}?`,
    assumeYes: context.yes,
  });

  const result = await context.client.postJson<MoveResult>(
    `/api/admin/venues/${venueId}/move`,
    { organizationId: targetOrg },
    { withOrg: false },
  );

  if (isJsonMode()) {
    emitJson(result);
    return;
  }
  success(
    `Moved venue ${venueId} to organization ${targetOrg} with ${result.movedSchemas} schema(s) and ${result.movedEvents} event(s)`,
  );
}

async function deleteVenue(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv);
  const ids = context.positionals
    .slice(1)
    .map((_, index) => positionalNumber(context.positionals, index + 1, 'venueId'));
  if (ids.length === 0) {
    throw new UsageError('At least one <venueId> is required');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `delete ${ids.length} venue(s)`,
    force: context.force,
  });

  const venues = await Promise.all(
    ids.map((id) => context.client.getJson<VenueDTO>(`/api/venues/${id}`)),
  );
  const listing = venues.map((venue) => `  ${venue.id} "${venue.name}"`).join('\n');
  await confirm({
    question: `Delete these ${ids.length} venues and everything under them on ${context.target.baseUrl}?\n${listing}`,
    assumeYes: context.yes,
  });

  const outcomes: DeleteOutcome[] = [];
  for (const id of ids) {
    try {
      await context.client.delete('/api/venues/', { query: { id } });
      outcomes.push({ id, deleted: true });
      info(`  deleted venue ${id}`);
    } catch (error) {
      outcomes.push({ id, deleted: false, error: describeError(error) });
    }
  }

  const failed = outcomes.filter((row) => !row.deleted);
  if (isJsonMode()) {
    emitJson(outcomes);
  } else {
    for (const row of failed) info(`  venue ${row.id} FAILED: ${row.error ?? ''}`);
    success(`Deleted ${outcomes.length - failed.length}/${outcomes.length} venue(s)`);
  }
  if (failed.length > 0) {
    throw new CliError(
      `${failed.length} of ${outcomes.length} venue deletions failed`,
      EXIT_FAILURE,
    );
  }
}

export async function venuesCommand(argv: readonly string[]): Promise<void> {
  const sub = argv[0] ?? 'list';
  switch (sub) {
    case 'list':
      return listVenues(argv.slice(1));
    case 'show':
      return showVenue(argv);
    case 'create':
      return createVenue(argv.slice(1));
    case 'rename':
      return renameVenue(argv);
    case 'move':
      return moveVenue(argv);
    case 'delete':
      return deleteVenue(argv);
    default:
      throw new UsageError(
        `Unknown subcommand "seatmap venues ${sub}"`,
        'Available: list, show, create, rename, move, delete',
      );
  }
}
