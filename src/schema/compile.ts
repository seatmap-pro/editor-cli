import { randomUUID } from 'node:crypto';
import { combineBounds, layoutSection, sectionBounds } from './layout.js';
import type { Bounds, PlacedSection } from './layout.js';
import { toVectorBackground } from './underlay.js';
import type { BuildSpec, GaSectionSpec, SectionSpec, ShapeSpec } from './spec.js';
import type {
  ClientViewBox,
  LabelShapeDTO,
  RowDTO,
  SeatDTO,
  SectorDTO,
  SeatmapDTO,
  ShapeDTO,
  SimpleShapeDTO,
  VectorBackgroundDTO,
} from '../api/types.js';

export interface CompileOptions {
  uuid?: () => string;
  viewBoxPadding?: number;
}

export interface SectionStat {
  name: string;
  type: SectionSpec['type'];
  rows: number;
  seats: number;
}

export interface CompileStats {
  sections: number;
  gaSections: number;
  shapes: number;
  rows: number;
  seats: number;
  perSection: SectionStat[];
}

export interface CompiledSeatmap {
  seatmap: SeatmapDTO;
  stats: CompileStats;
}

const DEFAULT_VIEWBOX_PADDING = 80;

function toSectorDTO(spec: SectionSpec, guid: string): SectorDTO {
  const sector: SectorDTO = {
    guid,
    name: spec.name,
    ga: spec.type === 'ga',
    x: spec.position.x,
    y: spec.position.y,
    rlLeft: spec.rowLabelLeft,
    rlRight: spec.rowLabelRight,
    rlCenter: spec.rowLabelCenter,
  };

  if (spec.titlePosition !== undefined) sector.titlePosition = spec.titlePosition;
  if (spec.titleFontScale !== undefined) sector.titleFontScale = spec.titleFontScale;

  if (spec.outline) {
    if (spec.outline.mode !== undefined) sector.outlineMode = spec.outline.mode;
    if (spec.outline.path !== undefined) sector.outline = spec.outline.path;
    const padding = spec.outline.padding;
    if (padding) {
      if (padding.top !== undefined) sector.outlinePaddingTop = padding.top;
      if (padding.right !== undefined) sector.outlinePaddingRight = padding.right;
      if (padding.bottom !== undefined) sector.outlinePaddingBottom = padding.bottom;
      if (padding.left !== undefined) sector.outlinePaddingLeft = padding.left;
    }
  }

  return sector;
}

function toGaShape(spec: GaSectionSpec, sectorGuid: string, id: string, order: number): ShapeDTO {
  const shape: SimpleShapeDTO = {
    type: 'shape',
    id,
    shapeType: spec.shapeType,
    purpose: 'GA',
    groupOfSeatsGuid: sectorGuid,
    left: spec.position.x,
    top: spec.position.y,
    width: spec.width,
    height: spec.height,
    order,
    text: spec.name,
  };

  if (spec.fill !== undefined) shape.fill = spec.fill;
  if (spec.textColor !== undefined) shape.textColor = spec.textColor;
  if (spec.points !== undefined) shape.points = spec.points;

  return shape;
}

function toStandaloneShape(spec: ShapeSpec, id: string, order: number): ShapeDTO {
  if (spec.kind === 'label') {
    const label: LabelShapeDTO = {
      type: 'label',
      id,
      left: spec.position.x,
      top: spec.position.y,
      width: spec.width,
      height: spec.height,
      order,
      text: spec.text,
    };
    if (spec.fill !== undefined) label.fill = spec.fill;
    if (spec.fontScale !== undefined) label.fontScale = spec.fontScale;
    return label;
  }

  const shape: SimpleShapeDTO = {
    type: 'shape',
    id,
    shapeType: spec.shapeType,
    purpose: 'OBJECT',
    left: spec.position.x,
    top: spec.position.y,
    width: spec.width,
    height: spec.height,
    order,
  };

  if (spec.angle !== undefined) shape.angle = spec.angle;
  if (spec.text !== undefined) shape.text = spec.text;
  if (spec.fill !== undefined) shape.fill = spec.fill;
  if (spec.stroke !== undefined) shape.stroke = spec.stroke;
  if (spec.textColor !== undefined) shape.textColor = spec.textColor;
  if (spec.points !== undefined) shape.points = spec.points;

  return shape;
}

function shapeBounds(spec: ShapeSpec): Bounds {
  return {
    minX: spec.position.x,
    minY: spec.position.y,
    maxX: spec.position.x + spec.width,
    maxY: spec.position.y + spec.height,
  };
}

function underlayBounds(background: VectorBackgroundDTO | undefined): Bounds | undefined {
  if (!background) return undefined;
  return {
    minX: background.x,
    minY: background.y,
    maxX: background.x + background.width,
    maxY: background.y + background.height,
  };
}

function toViewBox(
  sections: readonly PlacedSection[],
  shapes: readonly ShapeSpec[],
  background: VectorBackgroundDTO | undefined,
  padding: number,
): ClientViewBox | undefined {
  const bounds = combineBounds([
    ...sections.map(sectionBounds),
    ...shapes.map(shapeBounds),
    underlayBounds(background),
  ]);
  if (!bounds) return undefined;

  return {
    x: Math.round(bounds.minX - padding),
    y: Math.round(bounds.minY - padding),
    width: Math.max(1, Math.round(bounds.maxX - bounds.minX + padding * 2)),
    height: Math.max(1, Math.round(bounds.maxY - bounds.minY + padding * 2)),
    isControlledManually: false,
  };
}

export function compileSpec(spec: BuildSpec, options: CompileOptions = {}): CompiledSeatmap {
  const uuid = options.uuid ?? randomUUID;
  const padding = options.viewBoxPadding ?? DEFAULT_VIEWBOX_PADDING;

  const sectors: SectorDTO[] = [];
  const rows: RowDTO[] = [];
  const seats: SeatDTO[] = [];
  const shapes: ShapeDTO[] = [];
  const placed: PlacedSection[] = [];
  const perSection: SectionStat[] = [];

  let gaSections = 0;

  for (const sectionSpec of spec.sections) {
    const section = layoutSection(sectionSpec);
    placed.push(section);

    const sectorGuid = uuid();
    sectors.push(toSectorDTO(sectionSpec, sectorGuid));

    if (sectionSpec.type === 'ga') {
      gaSections += 1;
      shapes.push(toGaShape(sectionSpec, sectorGuid, uuid(), shapes.length));
      perSection.push({ name: sectionSpec.name, type: 'ga', rows: 0, seats: 0 });
      continue;
    }

    perSection.push({
      name: sectionSpec.name,
      type: sectionSpec.type,
      rows: section.rows.length,
      seats: section.rows.reduce((total, row) => total + row.seats.length, 0),
    });

    for (const row of section.rows) {
      const rowGuid = uuid();
      rows.push({
        guid: rowGuid,
        sectorGuid,
        name: row.name,
        rowNumber: row.rowNumber,
        seatName: row.seatName,
      });

      for (const seat of row.seats) {
        const dto: SeatDTO = {
          guid: uuid(),
          rowGuid,
          name: seat.name,
          x: seat.x,
          y: seat.y,
          ax: sectionSpec.position.x + seat.x,
          ay: sectionSpec.position.y + seat.y,
        };

        if (seat.angle !== undefined) dto.angle = seat.angle;
        if (seat.accessible !== undefined) dto.isAccessible = seat.accessible;
        if (seat.hidden !== undefined) dto.isHidden = seat.hidden;
        if (seat.marked !== undefined) dto.isMarked = seat.marked;

        seats.push(dto);
      }
    }
  }

  for (const shapeSpec of spec.shapes) {
    shapes.push(toStandaloneShape(shapeSpec, uuid(), shapes.length));
  }

  const vectorBackground = spec.underlay ? toVectorBackground(spec.underlay) : undefined;

  const seatmap: SeatmapDTO = { seats, rows, sectors };
  if (shapes.length > 0) seatmap.shapes = shapes;
  if (vectorBackground) seatmap.vectorBackground = vectorBackground;

  const viewBox = toViewBox(placed, spec.shapes, vectorBackground, padding);
  if (viewBox) seatmap.clientViewBox = viewBox;

  return {
    seatmap,
    stats: {
      sections: sectors.length,
      gaSections,
      shapes: spec.shapes.length,
      rows: rows.length,
      seats: seats.length,
      perSection,
    },
  };
}
