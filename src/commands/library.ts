import { numberOption, positionalNumber, stringOption } from '../cli/args.js';
import {
  CliError,
  EXIT_FAILURE,
  IndeterminateError,
  UsageError,
  describeError,
  leavesWriteUnconfirmed,
} from '../cli/errors.js';
import { emitJson, isJsonMode, output, success, warn } from '../cli/output.js';
import { assertMutationAllowed } from '../config/guards.js';
import { authenticatedContext } from './context.js';
import type { LibraryCopyResponse, LibraryVenueDTO, Page, VenueDTO } from '../api/types.js';

const LIST_OPTIONS = {
  search: { type: 'string' as const },
  limit: { type: 'string' as const },
};

const LISTING_OPTIONS = {
  list: { type: 'boolean' as const },
  unlist: { type: 'boolean' as const },
};

const COPY_OPTIONS = {
  to: { type: 'string' as const },
  schema: { type: 'string' as const },
};

function requireTarget(value: number | undefined): number {
  if (value === undefined) {
    throw new UsageError(
      '--to <orgId> is required',
      'It names the organization the copy is created in.',
    );
  }
  return value;
}

async function listLibrary(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);

  const page = await context.client.getJson<Page<LibraryVenueDTO>>('/api/library/venues', {
    query: {
      search: stringOption(context.values, 'search'),
      size: numberOption(context.values, 'limit') ?? 100,
    },
  });

  output(page.content ?? [], [
    { header: 'ID', value: (venue) => String(venue.id) },
    { header: 'NAME', value: (venue) => venue.name },
    {
      header: 'ORG',
      value: (venue) => venue.organizationName ?? String(venue.organizationId ?? ''),
    },
    { header: 'SCHEMAS', value: (venue) => String(venue.numberOfSchemas ?? '') },
  ]);
}

async function setListing(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LISTING_OPTIONS);
  const venueId = positionalNumber(context.positionals, 1, 'venueId');
  const listed = context.values['list'] === true;
  const unlisted = context.values['unlist'] === true;
  if (listed === unlisted) {
    throw new UsageError('Pass exactly one of --list or --unlist');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `${listed ? 'publish' : 'unpublish'} venue ${venueId} in the library`,
    force: context.force,
  });

  const venue = await context.client.putJson<VenueDTO>(`/api/venues/${venueId}/library-status`, {
    listed,
  });
  success(
    `Venue ${venueId} "${venue.name}" is ${venue.libraryListed ? 'listed in' : 'hidden from'} the library`,
  );
}

interface CopyOutcome {
  sourceVenueId: number;
  venueId?: number;
  schemaId?: number;
  error?: string;
  indeterminate?: boolean;
}

async function copy(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, COPY_OPTIONS);
  const venueIds = context.positionals
    .slice(1)
    .map((_, index) => positionalNumber(context.positionals, index + 1, 'venueId'));
  if (venueIds.length === 0) {
    throw new UsageError('At least one <venueId> is required');
  }
  const targetOrg = requireTarget(numberOption(context.values, 'to'));
  const schemaId = numberOption(context.values, 'schema');
  if (schemaId !== undefined && venueIds.length > 1) {
    throw new UsageError('--schema copies one schema, so it takes a single <venueId>');
  }

  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `copy ${schemaId === undefined ? `${venueIds.length} venue(s)` : `schema ${schemaId}`} into organization ${targetOrg}`,
    force: context.force,
  });

  const outcomes: CopyOutcome[] = [];
  for (const venueId of venueIds) {
    const path =
      schemaId === undefined
        ? `/api/library/venues/${venueId}/copy`
        : `/api/library/venues/${venueId}/schemas/${schemaId}/copy`;
    try {
      const result = await context.client.postJson<LibraryCopyResponse>(path, undefined, {
        withOrg: false,
        longRunning: true,
        query: { orgId: targetOrg },
      });
      outcomes.push({ sourceVenueId: venueId, ...result });
    } catch (error) {
      outcomes.push({
        sourceVenueId: venueId,
        error: describeError(error),
        indeterminate: leavesWriteUnconfirmed(error),
      });
    }
  }

  const unknown = outcomes.filter((row) => row.indeterminate === true).length;
  const failed = outcomes.filter(
    (row) => row.error !== undefined && row.indeterminate !== true,
  ).length;

  if (isJsonMode()) {
    emitJson(outcomes);
  } else {
    output(outcomes, [
      { header: 'SOURCE VENUE', value: (row) => String(row.sourceVenueId) },
      {
        header: 'NEW VENUE',
        value: (row) => (row.venueId === undefined ? '' : String(row.venueId)),
      },
      {
        header: 'NEW SCHEMA',
        value: (row) => (row.schemaId === undefined ? '' : String(row.schemaId)),
      },
      {
        header: 'STATUS',
        value: (row) => {
          if (row.error === undefined) return 'copied';
          return row.indeterminate === true ? 'unknown' : 'failed';
        },
      },
      { header: 'ERROR', value: (row) => row.error ?? '' },
    ]);

    success(
      `Copied ${outcomes.length - failed - unknown}/${outcomes.length} into organization ${targetOrg}` +
        (failed > 0 ? `, ${failed} failed` : '') +
        (unknown > 0 ? `, ${unknown} unknown` : ''),
    );
    if (unknown > 0) {
      warn(
        `${unknown} copy request(s) went unanswered. The server may have created the venue anyway, ` +
          `so list organization ${targetOrg} before retrying them.`,
      );
    }
  }

  if (failed > 0) {
    throw new CliError(
      `${failed} of ${outcomes.length} copies into organization ${targetOrg} failed`,
      EXIT_FAILURE,
    );
  }
  if (unknown > 0) {
    throw new IndeterminateError(
      `${unknown} of ${outcomes.length} copies into organization ${targetOrg} went unanswered`,
      `List organization ${targetOrg} before retrying them.`,
    );
  }
}

export async function libraryCommand(argv: readonly string[]): Promise<void> {
  const sub = argv[0] ?? 'list';
  switch (sub) {
    case 'list':
      return listLibrary(argv.slice(1));
    case 'publish':
      return setListing(argv);
    case 'copy':
      return copy(argv);
    default:
      throw new UsageError(
        `Unknown subcommand "seatmap library ${sub}"`,
        'Available: list, publish, copy',
      );
  }
}
