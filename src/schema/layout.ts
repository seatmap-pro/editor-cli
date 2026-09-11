import { rowNames, seatNames } from './numbering.js';
import { DEFAULT_SECTION_ORIGIN_OFFSET } from './spec.js';
import type {
  ArcSectionSpec,
  GridSectionSpec,
  SeatFlags,
  SeatSelector,
  SectionSpec,
} from './spec.js';

export interface PlacedSeat {
  name: string;
  x: number;
  y: number;
  angle?: number;
  accessible?: boolean;
  hidden?: boolean;
  marked?: boolean;
}

export interface PlacedRow {
  name: string;
  rowNumber: string;
  seatName: string;
  seats: PlacedSeat[];
}

export interface PlacedSection {
  spec: SectionSpec;
  rows: PlacedRow[];
}

const matchesSelector = (selector: SeatSelector, rowNumber: string, seatName: string): boolean => {
  if (selector.row !== rowNumber) return false;
  if (selector.seats === undefined) return true;
  return selector.seats.includes(seatName);
};

function isSkipped(skips: readonly SeatSelector[], rowNumber: string, seatName: string): boolean {
  return skips.some((selector) => matchesSelector(selector, rowNumber, seatName));
}

function flagsFor(
  flags: readonly SeatFlags[],
  rowNumber: string,
  seatName: string,
): Pick<PlacedSeat, 'accessible' | 'hidden' | 'marked'> {
  const result: Pick<PlacedSeat, 'accessible' | 'hidden' | 'marked'> = {};
  for (const flag of flags) {
    if (!matchesSelector(flag, rowNumber, seatName)) continue;
    if (flag.accessible !== undefined) result.accessible = flag.accessible;
    if (flag.hidden !== undefined) result.hidden = flag.hidden;
    if (flag.marked !== undefined) result.marked = flag.marked;
  }
  return result;
}

export function layoutGrid(spec: GridSectionSpec): PlacedRow[] {
  const rowLabels = rowNames(spec.rows, spec.numbering?.rows);
  const seatLabels = seatNames(spec.seatsPerRow, spec.numbering?.seats);
  const rows: PlacedRow[] = [];

  for (let rowIndex = 0; rowIndex < spec.rows; rowIndex += 1) {
    const rowNumber = rowLabels[rowIndex] ?? String(rowIndex + 1);
    const seats: PlacedSeat[] = [];

    for (let seatIndex = 0; seatIndex < spec.seatsPerRow; seatIndex += 1) {
      const seatName = seatLabels[seatIndex] ?? String(seatIndex + 1);
      if (isSkipped(spec.skip, rowNumber, seatName)) continue;

      seats.push({
        name: seatName,
        x: DEFAULT_SECTION_ORIGIN_OFFSET + seatIndex * spec.spacingX,
        y: DEFAULT_SECTION_ORIGIN_OFFSET + rowIndex * spec.spacingY,
        ...flagsFor(spec.flags, rowNumber, seatName),
      });
    }

    if (seats.length === 0) continue;
    rows.push({ name: spec.rowLabel, rowNumber, seatName: spec.seatLabel, seats });
  }

  return rows;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function layoutArc(spec: ArcSectionSpec): PlacedRow[] {
  const rowLabels = rowNames(spec.rows, spec.numbering?.rows);
  const seatLabels = seatNames(spec.seatsPerRow, spec.numbering?.seats);
  const rows: PlacedRow[] = [];

  const sweep = spec.arcDegrees;
  const startAngle = 90 - sweep / 2;
  const angleStep = spec.seatsPerRow > 1 ? sweep / (spec.seatsPerRow - 1) : 0;

  for (let rowIndex = 0; rowIndex < spec.rows; rowIndex += 1) {
    const rowNumber = rowLabels[rowIndex] ?? String(rowIndex + 1);
    const radius = spec.radius + rowIndex * spec.rowSpacing;
    const seats: PlacedSeat[] = [];

    for (let seatIndex = 0; seatIndex < spec.seatsPerRow; seatIndex += 1) {
      const seatName = seatLabels[seatIndex] ?? String(seatIndex + 1);
      if (isSkipped(spec.skip, rowNumber, seatName)) continue;

      const degrees = spec.seatsPerRow > 1 ? startAngle + seatIndex * angleStep : 90;
      const radians = toRadians(degrees);

      seats.push({
        name: seatName,
        x: round(radius * Math.cos(radians)),
        y: round(radius * Math.sin(radians)),
        angle: round(spec.facing === 'in' ? degrees - 90 : degrees + 90),
        ...flagsFor(spec.flags, rowNumber, seatName),
      });
    }

    if (seats.length === 0) continue;
    rows.push({ name: spec.rowLabel, rowNumber, seatName: spec.seatLabel, seats });
  }

  return rows;
}

export function layoutSection(spec: SectionSpec): PlacedSection {
  switch (spec.type) {
    case 'grid':
      return { spec, rows: layoutGrid(spec) };
    case 'arc':
      return { spec, rows: layoutArc(spec) };
    case 'ga':
      return { spec, rows: [] };
  }
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function sectionBounds(section: PlacedSection): Bounds | undefined {
  const { position } = section.spec;

  if (section.spec.type === 'ga') {
    return {
      minX: position.x,
      minY: position.y,
      maxX: position.x + section.spec.width,
      maxY: position.y + section.spec.height,
    };
  }

  let bounds: Bounds | undefined;
  for (const row of section.rows) {
    for (const seat of row.seats) {
      const x = position.x + seat.x;
      const y = position.y + seat.y;
      bounds = bounds
        ? {
            minX: Math.min(bounds.minX, x),
            minY: Math.min(bounds.minY, y),
            maxX: Math.max(bounds.maxX, x),
            maxY: Math.max(bounds.maxY, y),
          }
        : { minX: x, minY: y, maxX: x, maxY: y };
    }
  }
  return bounds;
}

export function combineBounds(all: ReadonlyArray<Bounds | undefined>): Bounds | undefined {
  let result: Bounds | undefined;
  for (const bounds of all) {
    if (!bounds) continue;
    result = result
      ? {
          minX: Math.min(result.minX, bounds.minX),
          minY: Math.min(result.minY, bounds.minY),
          maxX: Math.max(result.maxX, bounds.maxX),
          maxY: Math.max(result.maxY, bounds.maxY),
        }
      : bounds;
  }
  return result;
}

export function countSeats(sections: readonly PlacedSection[]): number {
  return sections.reduce(
    (total, section) =>
      total + section.rows.reduce((rowTotal, row) => rowTotal + row.seats.length, 0),
    0,
  );
}
