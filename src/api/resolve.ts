import { UsageError } from '../cli/errors.js';
import type { BuildSpec } from '../schema/spec.js';
import type { ApiClient } from './client.js';
import type { Page, SchemaDTO, SeatmapDTO, VenueDTO } from './types.js';

export interface ResolvedTargetId {
  id: number;
  created: boolean;
}

export interface SeatmapSize {
  sectors: number;
  rows: number;
  seats: number;
}

export async function resolveVenue(
  client: ApiClient,
  spec: BuildSpec,
  explicit: number | undefined,
  missingVenueHint: string,
): Promise<ResolvedTargetId> {
  if (explicit !== undefined) return { id: explicit, created: false };

  if (!spec.venue) {
    throw new UsageError('No venue specified.', missingVenueHint);
  }

  const existing = await client.getJson<Page<VenueDTO>>('/api/venues/', {
    query: { search: spec.venue.name, size: 100 },
  });
  const match = (existing.content ?? []).find((venue) => venue.name === spec.venue?.name);
  if (match) return { id: match.id, created: false };

  const created = await client.postJson<VenueDTO>('/api/venues/', {
    name: spec.venue.name,
    address: spec.venue.address,
    lat: spec.venue.lat,
    lng: spec.venue.lng,
  });
  return { id: created.id, created: true };
}

export async function resolveSchema(
  client: ApiClient,
  spec: BuildSpec,
  venueId: number,
  explicit: number | undefined,
  name: string | undefined,
): Promise<ResolvedTargetId> {
  if (explicit !== undefined) return { id: explicit, created: false };

  const created = await client.postJson<SchemaDTO>(`/api/venues/${venueId}/schemas/`, {
    name: name ?? spec.schema.name,
    description: spec.schema.description,
    draft: spec.schema.draft ?? true,
    gaCapacity: spec.schema.gaCapacity,
  });
  return { id: created.id, created: true };
}

export async function seatmapSize(client: ApiClient, schemaId: number): Promise<SeatmapSize> {
  const current = await client.getJson<SeatmapDTO>(`/api/seatmap/${schemaId}/`);
  return {
    sectors: (current.sectors ?? []).length,
    rows: (current.rows ?? []).length,
    seats: (current.seats ?? []).length,
  };
}

export function isEmpty(size: SeatmapSize): boolean {
  return size.sectors === 0 && size.rows === 0 && size.seats === 0;
}
