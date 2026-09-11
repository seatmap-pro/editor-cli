import { writeFileSync } from 'node:fs';
import { boolOption, numberOption, positional, stringOption } from '../cli/args.js';
import { confirm } from '../cli/confirm.js';
import { UsageError } from '../cli/errors.js';
import { dim, emitJson, info, isJsonMode, output, success } from '../cli/output.js';
import { assertMutationAllowed } from '../config/guards.js';
import { resolveSchema, resolveVenue } from '../api/resolve.js';
import { compileSpec } from '../schema/compile.js';
import { loadUnderlay, readSpecFile } from '../schema/load.js';
import { parseSpec } from '../schema/spec.js';
import { authenticatedContext, createContext } from './context.js';
import type { ApiClient } from '../api/client.js';
import type { SeatmapDTO } from '../api/types.js';

const BUILD_OPTIONS = {
  venue: { type: 'string' as const },
  schema: { type: 'string' as const },
  name: { type: 'string' as const },
  out: { type: 'string' as const },
  'dry-run': { type: 'boolean' as const },
  replace: { type: 'boolean' as const },
  'force-delete': { type: 'boolean' as const },
};

async function buildRemovals(client: ApiClient, schemaId: number): Promise<SeatmapDTO> {
  const current = await client.getJson<SeatmapDTO>(`/api/seatmap/${schemaId}/`);
  return {
    seats: (current.seats ?? []).map((seat) => ({ ...seat, toRemove: true })),
    rows: [],
    sectors: (current.sectors ?? []).map((sector) => ({ ...sector, toRemove: true })),
  };
}

export async function buildCommand(argv: readonly string[]): Promise<void> {
  const dryRunContext = createContext(argv, BUILD_OPTIONS);
  const specPath = positional(dryRunContext.positionals, 0, 'spec-file');
  const spec = loadUnderlay(
    parseSpec(await readSpecFile(specPath, { allowModules: true, allowStdin: true })),
    specPath,
  );
  const compiled = compileSpec(spec);

  const outPath = stringOption(dryRunContext.values, 'out');
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(compiled.seatmap, null, 2)}\n`);
  }

  const summary = compiled.stats.perSection.map((section) => ({
    name: section.name,
    type: section.type,
    rows: section.type === 'ga' ? '-' : String(section.rows),
    seats: section.type === 'ga' ? '-' : String(section.seats),
  }));

  if (boolOption(dryRunContext.values, 'dry-run')) {
    if (isJsonMode()) {
      emitJson({ stats: compiled.stats, seatmap: compiled.seatmap });
      return;
    }
    info(`Compiled "${spec.schema.name}" from ${specPath}`);
    output(summary, [
      { header: 'SECTION', value: (row) => row.name },
      { header: 'TYPE', value: (row) => row.type },
      { header: 'ROWS', value: (row) => row.rows },
      { header: 'SEATS', value: (row) => row.seats },
    ]);
    info(
      dim(
        `Total: ${compiled.stats.sections} sections (${compiled.stats.gaSections} GA), ${compiled.stats.rows} rows, ${compiled.stats.seats} seats, ${compiled.stats.shapes} shapes`,
      ),
    );
    const background = compiled.seatmap.vectorBackground;
    if (background) {
      info(
        dim(
          `Underlay: ${background.width}x${background.height} at (${background.x}, ${background.y}), scale ${background.scale.toFixed(3)}, ${background.backgroundSvg.length} bytes`,
        ),
      );
    }
    if (outPath) info(dim(`Payload written to ${outPath}`));
    return;
  }

  const context = authenticatedContext(argv, BUILD_OPTIONS);
  assertMutationAllowed({
    baseUrl: context.target.baseUrl,
    action: `build schema "${spec.schema.name}"`,
    force: context.force,
  });

  const venue = await resolveVenue(
    context.client,
    spec,
    numberOption(context.values, 'venue'),
    'Pass --venue <id> or add a "venue" block to the spec.',
  );
  const schema = await resolveSchema(
    context.client,
    spec,
    venue.id,
    numberOption(context.values, 'schema'),
    stringOption(context.values, 'name'),
  );
  const replace = boolOption(context.values, 'replace');
  const forceDelete = boolOption(context.values, 'force-delete');

  let payload: SeatmapDTO = compiled.seatmap;

  if (replace) {
    if (schema.created) {
      throw new UsageError(
        '--replace only applies when pushing into an existing schema.',
        'Pass --schema <id> together with --replace.',
      );
    }
    const removals = await buildRemovals(context.client, schema.id);
    await confirm({
      question: `Replace the contents of schema ${schema.id} on ${context.target.baseUrl}? This removes ${removals.seats.length} existing seats and ${removals.sectors.length} sections.`,
      assumeYes: context.yes,
    });
    payload = {
      ...compiled.seatmap,
      seats: [...removals.seats, ...compiled.seatmap.seats],
      sectors: [...removals.sectors, ...compiled.seatmap.sectors],
    };
  }

  if (forceDelete) {
    await confirm({
      question: 'Allow removing seats that are already sold?',
      assumeYes: context.yes,
      expected: 'force-delete',
    });
  }

  await context.client.putJson<SeatmapDTO>(`/api/seatmap/${schema.id}/`, payload, {
    query: forceDelete ? { forceDelete: true } : {},
  });

  if (isJsonMode()) {
    emitJson({
      venueId: venue.id,
      venueCreated: venue.created,
      schemaId: schema.id,
      schemaCreated: schema.created,
      stats: compiled.stats,
    });
    return;
  }

  success(
    `Pushed ${compiled.stats.seats} seats in ${compiled.stats.rows} rows across ${compiled.stats.sections} sections`,
  );
  info(`Venue   ${venue.id}${venue.created ? ' (created)' : ''}`);
  info(`Schema  ${schema.id}${schema.created ? ' (created)' : ''}`);
  if (outPath) info(dim(`Payload written to ${outPath}`));
}
