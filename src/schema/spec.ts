import { UsageError } from '../cli/errors.js';
import type { RowNumbering, SeatNumbering } from './numbering.js';
import type { SectionOutlineMode, SectionTitlePosition, SimpleShapeType } from '../api/types.js';

export interface Point {
  x: number;
  y: number;
}

export interface VenueSpec {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface SchemaSpec {
  name: string;
  description?: string;
  draft?: boolean;
  gaCapacity?: number;
}

export interface SectionNumbering {
  rows?: RowNumbering;
  seats?: SeatNumbering;
}

export interface SeatSelector {
  row: string;
  seats?: string[];
}

export interface SeatFlags extends SeatSelector {
  accessible?: boolean;
  hidden?: boolean;
  marked?: boolean;
}

export interface OutlineSpec {
  mode?: SectionOutlineMode;
  path?: string;
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
}

export interface BaseSectionSpec {
  name: string;
  position: Point;
  rowLabelLeft: boolean;
  rowLabelRight: boolean;
  rowLabelCenter: boolean;
  titlePosition?: SectionTitlePosition;
  titleFontScale?: number;
  outline?: OutlineSpec;
  rowLabel: string;
  seatLabel: string;
  numbering?: SectionNumbering;
}

export interface GridSectionSpec extends BaseSectionSpec {
  type: 'grid';
  rows: number;
  seatsPerRow: number;
  spacingX: number;
  spacingY: number;
  skip: SeatSelector[];
  flags: SeatFlags[];
}

export interface ArcSectionSpec extends BaseSectionSpec {
  type: 'arc';
  rows: number;
  seatsPerRow: number;
  radius: number;
  arcDegrees: number;
  rowSpacing: number;
  facing: 'in' | 'out';
  skip: SeatSelector[];
  flags: SeatFlags[];
}

export interface GaSectionSpec extends BaseSectionSpec {
  type: 'ga';
  shapeType: SimpleShapeType;
  width: number;
  height: number;
  points?: Point[];
  fill?: string;
  textColor?: string;
}

export type SectionSpec = GridSectionSpec | ArcSectionSpec | GaSectionSpec;

export interface ObjectShapeSpec {
  kind: 'shape';
  shapeType: SimpleShapeType;
  position: Point;
  width: number;
  height: number;
  angle?: number;
  text?: string;
  fill?: string;
  stroke?: string;
  textColor?: string;
  points?: Point[];
}

export interface LabelShapeSpec {
  kind: 'label';
  position: Point;
  width: number;
  height: number;
  text: string;
  fill?: string;
  fontScale?: number;
}

export type ShapeSpec = ObjectShapeSpec | LabelShapeSpec;

export interface UnderlaySpec {
  file?: string;
  svg?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  scale?: number;
}

export interface BuildSpec {
  venue?: VenueSpec;
  schema: SchemaSpec;
  sections: SectionSpec[];
  shapes: ShapeSpec[];
  underlay?: UnderlaySpec;
}

export const DEFAULT_SEAT_PITCH = 28;
export const DEFAULT_SECTION_ORIGIN_OFFSET = 19;
export const DEFAULT_ROW_LABEL = 'Row';
export const DEFAULT_SEAT_LABEL = 'Seat';
export const DEFAULT_GA_SIZE = 250;
export const DEFAULT_STAGE_WIDTH = 600;
export const DEFAULT_STAGE_HEIGHT = 120;
export const DEFAULT_STAGE_TEXT = 'STAGE';
export const DEFAULT_LABEL_SIZE = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function reject(path: string, expectation: string): never {
  throw new UsageError(`Invalid spec at "${path}": ${expectation}`);
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) reject(path, 'expected an object');
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    reject(path, 'expected a non-empty string');
  }
  return value;
}

function optString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, path);
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject(path, 'expected a finite number');
  }
  return value;
}

function optNumber(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asNumber(value, path);
}

function asPositiveInt(value: unknown, path: string): number {
  const parsed = asNumber(value, path);
  if (!Number.isInteger(parsed) || parsed <= 0) reject(path, 'expected a positive integer');
  return parsed;
}

function optBool(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') reject(path, 'expected a boolean');
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) reject(path, 'expected an array');
  return value;
}

function optEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = asString(value, path);
  if (!allowed.includes(parsed as T)) {
    reject(path, `expected one of ${allowed.join(', ')}`);
  }
  return parsed as T;
}

function parsePoint(value: unknown, path: string): Point {
  const record = asObject(value, path);
  return { x: asNumber(record['x'], `${path}.x`), y: asNumber(record['y'], `${path}.y`) };
}

function parseRowNumbering(value: unknown, path: string): RowNumbering | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asObject(value, path);
  return {
    format: optEnum(record['format'], `${path}.format`, ['arabic', 'roman', 'letters'] as const),
    from: optString(record['from'], `${path}.from`),
    step: optNumber(record['step'], `${path}.step`),
    direction: optEnum(record['direction'], `${path}.direction`, ['toBottom', 'toTop'] as const),
  };
}

function parseSeatNumbering(value: unknown, path: string): SeatNumbering | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asObject(value, path);
  return {
    from: optString(record['from'], `${path}.from`),
    step: optNumber(record['step'], `${path}.step`),
    direction: optEnum(record['direction'], `${path}.direction`, ['toRight', 'toLeft'] as const),
  };
}

function parseNumbering(value: unknown, path: string): SectionNumbering | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asObject(value, path);
  return {
    rows: parseRowNumbering(record['rows'], `${path}.rows`),
    seats: parseSeatNumbering(record['seats'], `${path}.seats`),
  };
}

function parseSelectors(value: unknown, path: string): SeatSelector[] {
  if (value === undefined || value === null) return [];
  return asArray(value, path).map((entry, index) => {
    const record = asObject(entry, `${path}[${index}]`);
    const seats = record['seats'];
    return {
      row: asString(record['row'], `${path}[${index}].row`),
      seats:
        seats === undefined || seats === null
          ? undefined
          : asArray(seats, `${path}[${index}].seats`).map((seat, seatIndex) =>
              asString(seat, `${path}[${index}].seats[${seatIndex}]`),
            ),
    };
  });
}

function parseFlags(value: unknown, path: string): SeatFlags[] {
  if (value === undefined || value === null) return [];
  return asArray(value, path).map((entry, index) => {
    const record = asObject(entry, `${path}[${index}]`);
    const selector = parseSelectors([entry], path)[0];
    if (!selector) reject(`${path}[${index}]`, 'expected a seat selector');
    return {
      ...selector,
      accessible: optBool(record['accessible'], `${path}[${index}].accessible`),
      hidden: optBool(record['hidden'], `${path}[${index}].hidden`),
      marked: optBool(record['marked'], `${path}[${index}].marked`),
    };
  });
}

function parseOutline(value: unknown, path: string): OutlineSpec | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asObject(value, path);
  const padding = record['padding'];
  return {
    mode: optEnum(record['mode'], `${path}.mode`, ['NONE', 'AUTO', 'SVG'] as const),
    path: optString(record['path'], `${path}.path`),
    padding:
      padding === undefined || padding === null
        ? undefined
        : {
            top: optNumber(asObject(padding, `${path}.padding`)['top'], `${path}.padding.top`),
            right: optNumber(
              asObject(padding, `${path}.padding`)['right'],
              `${path}.padding.right`,
            ),
            bottom: optNumber(
              asObject(padding, `${path}.padding`)['bottom'],
              `${path}.padding.bottom`,
            ),
            left: optNumber(asObject(padding, `${path}.padding`)['left'], `${path}.padding.left`),
          },
  };
}

function parseBaseSection(record: Record<string, unknown>, path: string): BaseSectionSpec {
  const labels = record['rowLabels'];
  const labelRecord =
    labels === undefined || labels === null ? {} : asObject(labels, `${path}.rowLabels`);
  const title = record['title'];
  const titleRecord = title === undefined || title === null ? {} : asObject(title, `${path}.title`);

  return {
    name: asString(record['name'], `${path}.name`),
    position:
      record['position'] === undefined || record['position'] === null
        ? { x: 0, y: 0 }
        : parsePoint(record['position'], `${path}.position`),
    rowLabelLeft: optBool(labelRecord['left'], `${path}.rowLabels.left`) ?? false,
    rowLabelRight: optBool(labelRecord['right'], `${path}.rowLabels.right`) ?? false,
    rowLabelCenter: optBool(labelRecord['center'], `${path}.rowLabels.center`) ?? false,
    titlePosition: optEnum(titleRecord['position'], `${path}.title.position`, [
      'NONE',
      'TOP',
      'BOTTOM',
    ] as const),
    titleFontScale: optNumber(titleRecord['fontScale'], `${path}.title.fontScale`),
    outline: parseOutline(record['outline'], `${path}.outline`),
    rowLabel: optString(record['rowLabel'], `${path}.rowLabel`) ?? DEFAULT_ROW_LABEL,
    seatLabel: optString(record['seatLabel'], `${path}.seatLabel`) ?? DEFAULT_SEAT_LABEL,
    numbering: parseNumbering(record['numbering'], `${path}.numbering`),
  };
}

function parseSection(value: unknown, index: number): SectionSpec {
  const path = `sections[${index}]`;
  const record = asObject(value, path);
  const base = parseBaseSection(record, path);
  const type = optEnum(record['type'], `${path}.type`, ['grid', 'arc', 'ga'] as const) ?? 'grid';

  if (type === 'ga') {
    const points = record['points'];
    return {
      ...base,
      type: 'ga',
      shapeType:
        optEnum(record['shape'], `${path}.shape`, ['RECT', 'CIRCLE', 'POLYGON', 'LINE'] as const) ??
        'RECT',
      width: optNumber(record['width'], `${path}.width`) ?? DEFAULT_GA_SIZE,
      height: optNumber(record['height'], `${path}.height`) ?? DEFAULT_GA_SIZE,
      points:
        points === undefined || points === null
          ? undefined
          : asArray(points, `${path}.points`).map((point, pointIndex) =>
              parsePoint(point, `${path}.points[${pointIndex}]`),
            ),
      fill: optString(record['fill'], `${path}.fill`),
      textColor: optString(record['textColor'], `${path}.textColor`),
    };
  }

  const rows = asPositiveInt(record['rows'], `${path}.rows`);
  const seatsPerRow = asPositiveInt(record['seatsPerRow'], `${path}.seatsPerRow`);
  const skip = parseSelectors(record['skip'], `${path}.skip`);
  const flags = parseFlags(record['flags'], `${path}.flags`);

  if (type === 'arc') {
    return {
      ...base,
      type: 'arc',
      rows,
      seatsPerRow,
      radius: asNumber(record['radius'], `${path}.radius`),
      arcDegrees: optNumber(record['arcDegrees'], `${path}.arcDegrees`) ?? 90,
      rowSpacing: optNumber(record['rowSpacing'], `${path}.rowSpacing`) ?? DEFAULT_SEAT_PITCH,
      facing: optEnum(record['facing'], `${path}.facing`, ['in', 'out'] as const) ?? 'in',
      skip,
      flags,
    };
  }

  const spacing = record['spacing'];
  const spacingRecord =
    spacing === undefined || spacing === null ? {} : asObject(spacing, `${path}.spacing`);

  return {
    ...base,
    type: 'grid',
    rows,
    seatsPerRow,
    spacingX: optNumber(spacingRecord['x'], `${path}.spacing.x`) ?? DEFAULT_SEAT_PITCH,
    spacingY: optNumber(spacingRecord['y'], `${path}.spacing.y`) ?? DEFAULT_SEAT_PITCH,
    skip,
    flags,
  };
}

function parseShape(value: unknown, index: number): ShapeSpec {
  const path = `shapes[${index}]`;
  const record = asObject(value, path);
  const type =
    optEnum(record['type'], `${path}.type`, ['stage', 'shape', 'label'] as const) ?? 'shape';

  const position =
    record['position'] === undefined || record['position'] === null
      ? { x: 0, y: 0 }
      : parsePoint(record['position'], `${path}.position`);

  if (type === 'label') {
    return {
      kind: 'label',
      position,
      width: optNumber(record['width'], `${path}.width`) ?? DEFAULT_LABEL_SIZE,
      height: optNumber(record['height'], `${path}.height`) ?? DEFAULT_LABEL_SIZE,
      text: asString(record['text'], `${path}.text`),
      fill: optString(record['fill'], `${path}.fill`),
      fontScale: optNumber(record['fontScale'], `${path}.fontScale`),
    };
  }

  const isStage = type === 'stage';
  const points = record['points'];

  return {
    kind: 'shape',
    shapeType:
      optEnum(record['shape'], `${path}.shape`, ['RECT', 'CIRCLE', 'POLYGON', 'LINE'] as const) ??
      'RECT',
    position,
    width:
      optNumber(record['width'], `${path}.width`) ??
      (isStage ? DEFAULT_STAGE_WIDTH : DEFAULT_GA_SIZE),
    height:
      optNumber(record['height'], `${path}.height`) ??
      (isStage ? DEFAULT_STAGE_HEIGHT : DEFAULT_GA_SIZE),
    angle: optNumber(record['angle'], `${path}.angle`),
    text: optString(record['text'], `${path}.text`) ?? (isStage ? DEFAULT_STAGE_TEXT : undefined),
    fill: optString(record['fill'], `${path}.fill`),
    stroke: optString(record['stroke'], `${path}.stroke`),
    textColor: optString(record['textColor'], `${path}.textColor`),
    points:
      points === undefined || points === null
        ? undefined
        : asArray(points, `${path}.points`).map((point, pointIndex) =>
            parsePoint(point, `${path}.points[${pointIndex}]`),
          ),
  };
}

function parseUnderlay(value: unknown): UnderlaySpec | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asObject(value, 'underlay');

  const file = optString(record['file'], 'underlay.file');
  const svg = optString(record['svg'], 'underlay.svg');

  if (file === undefined && svg === undefined) {
    reject('underlay', 'expected either "file" or "svg"');
  }
  if (file !== undefined && svg !== undefined) {
    reject('underlay', 'expected only one of "file" or "svg"');
  }

  const position =
    record['position'] === undefined || record['position'] === null
      ? undefined
      : parsePoint(record['position'], 'underlay.position');

  const scale = optNumber(record['scale'], 'underlay.scale');
  if (scale !== undefined && scale <= 0) reject('underlay.scale', 'expected a positive number');

  const width = optNumber(record['width'], 'underlay.width');
  if (width !== undefined && width <= 0) reject('underlay.width', 'expected a positive number');

  const height = optNumber(record['height'], 'underlay.height');
  if (height !== undefined && height <= 0) reject('underlay.height', 'expected a positive number');

  return { file, svg, x: position?.x, y: position?.y, width, height, scale };
}

export function parseSpec(raw: unknown): BuildSpec {
  const root = asObject(raw, 'spec');

  const venueValue = root['venue'];
  const venue =
    venueValue === undefined || venueValue === null
      ? undefined
      : (() => {
          const record = asObject(venueValue, 'venue');
          return {
            name: asString(record['name'], 'venue.name'),
            address: optString(record['address'], 'venue.address'),
            lat: optNumber(record['lat'], 'venue.lat'),
            lng: optNumber(record['lng'], 'venue.lng'),
          };
        })();

  const schemaRecord = asObject(root['schema'], 'schema');
  const schema: SchemaSpec = {
    name: asString(schemaRecord['name'], 'schema.name'),
    description: optString(schemaRecord['description'], 'schema.description'),
    draft: optBool(schemaRecord['draft'], 'schema.draft'),
    gaCapacity: optNumber(schemaRecord['gaCapacity'], 'schema.gaCapacity'),
  };

  const sections = asArray(root['sections'], 'sections').map(parseSection);
  if (sections.length === 0) reject('sections', 'expected at least one section');

  const names = new Set<string>();
  for (const section of sections) {
    if (names.has(section.name)) {
      reject('sections', `duplicate section name "${section.name}"`);
    }
    names.add(section.name);
  }

  const shapesValue = root['shapes'];
  const shapes =
    shapesValue === undefined || shapesValue === null
      ? []
      : asArray(shapesValue, 'shapes').map(parseShape);

  return { venue, schema, sections, shapes, underlay: parseUnderlay(root['underlay']) };
}
