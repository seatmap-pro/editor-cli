import { numberOption, positional, stringOption } from '../cli/args.js';
import { UsageError } from '../cli/errors.js';
import { emitJson, isJsonMode, output } from '../cli/output.js';
import { authenticatedContext } from './context.js';
import type { EventDTO, Page } from '../api/types.js';

const LIST_OPTIONS = {
  schema: { type: 'string' as const },
  venue: { type: 'string' as const },
  status: { type: 'string' as const },
  search: { type: 'string' as const },
  limit: { type: 'string' as const },
};

async function listEvents(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv, LIST_OPTIONS);

  const page = await context.client.getJson<Page<EventDTO>>('/api/events', {
    query: {
      schemaId: numberOption(context.values, 'schema'),
      venueId: numberOption(context.values, 'venue'),
      status: stringOption(context.values, 'status'),
      search: stringOption(context.values, 'search'),
      size: numberOption(context.values, 'limit') ?? 50,
    },
  });

  output(page.content ?? [], [
    { header: 'ID', value: (event) => event.id },
    { header: 'NAME', value: (event) => event.name },
    { header: 'SCHEMA', value: (event) => event.schemaName ?? String(event.schemaId ?? '') },
    { header: 'STATUS', value: (event) => event.status ?? '' },
    { header: 'STARTS', value: (event) => event.startsAt ?? '' },
  ]);
}

async function showEvent(argv: readonly string[]): Promise<void> {
  const context = authenticatedContext(argv);
  const eventId = positional(context.positionals, 1, 'eventId');
  const event = await context.client.getJson<EventDTO>(`/api/events/${eventId}`);

  if (isJsonMode()) {
    emitJson(event);
    return;
  }

  output(
    [event],
    [
      { header: 'ID', value: (row) => row.id },
      { header: 'NAME', value: (row) => row.name },
      { header: 'SCHEMA', value: (row) => row.schemaName ?? String(row.schemaId ?? '') },
      { header: 'STATUS', value: (row) => row.status ?? '' },
      { header: 'STARTS', value: (row) => row.startsAt ?? '' },
    ],
  );
}

export async function eventsCommand(argv: readonly string[]): Promise<void> {
  const sub = argv[0] ?? 'list';
  switch (sub) {
    case 'list':
      return listEvents(argv.slice(1));
    case 'show':
      return showEvent(argv);
    default:
      throw new UsageError(`Unknown subcommand "seatmap events ${sub}"`, 'Available: list, show');
  }
}
