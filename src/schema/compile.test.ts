import { describe, expect, it } from 'vitest';
import { compileSpec } from './compile.js';
import { parseSpec, DEFAULT_SECTION_ORIGIN_OFFSET } from './spec.js';
import type { SimpleShapeDTO } from '../api/types.js';

function sequentialUuid(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  };
}

const compile = (raw: unknown) => compileSpec(parseSpec(raw), { uuid: sequentialUuid() });

describe('compileSpec', () => {
  it('links seats to rows and rows to sectors by guid', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 2, seatsPerRow: 2 }],
    });

    expect(seatmap.sectors).toHaveLength(1);
    expect(seatmap.rows).toHaveLength(2);
    expect(seatmap.seats).toHaveLength(4);

    const sector = seatmap.sectors[0]!;
    expect(seatmap.rows.every((row) => row.sectorGuid === sector.guid)).toBe(true);

    const rowGuids = new Set(seatmap.rows.map((row) => row.guid));
    expect(seatmap.seats.every((seat) => rowGuids.has(seat.rowGuid))).toBe(true);
  });

  it('emits absolute coordinates as section position plus local position', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 1, seatsPerRow: 1, position: { x: 500, y: -250 } }],
    });

    const seat = seatmap.seats[0]!;
    expect(seat.x).toBe(DEFAULT_SECTION_ORIGIN_OFFSET);
    expect(seat.y).toBe(DEFAULT_SECTION_ORIGIN_OFFSET);
    expect(seat.ax).toBe(500 + DEFAULT_SECTION_ORIGIN_OFFSET);
    expect(seat.ay).toBe(-250 + DEFAULT_SECTION_ORIGIN_OFFSET);
  });

  it('generates unique guids across sectors, rows and seats', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 2, seatsPerRow: 3 }],
    });

    const guids = [
      ...seatmap.sectors.map((sector) => sector.guid),
      ...seatmap.rows.map((row) => row.guid),
      ...seatmap.seats.map((seat) => seat.guid),
    ];
    expect(new Set(guids).size).toBe(guids.length);
  });

  it('creates a GA sector with a linked GA shape and no seats', () => {
    const { seatmap, stats } = compile({
      schema: { name: 'Main' },
      sections: [
        {
          name: 'Standing',
          type: 'ga',
          position: { x: 0, y: 0 },
          width: 400,
          height: 200,
          fill: '#cccccc',
        },
      ],
    });

    expect(stats.gaSections).toBe(1);
    expect(seatmap.seats).toHaveLength(0);
    expect(seatmap.rows).toHaveLength(0);

    const sector = seatmap.sectors[0]!;
    expect(sector.ga).toBe(true);

    const shape = seatmap.shapes?.[0] as SimpleShapeDTO | undefined;
    expect(shape?.type).toBe('shape');
    expect(shape?.purpose).toBe('GA');
    expect(shape?.groupOfSeatsGuid).toBe(sector.guid);
    expect(shape?.width).toBe(400);
    expect(shape?.fill).toBe('#cccccc');
  });

  it('computes a view box that contains every section', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [
        { name: 'Left', rows: 1, seatsPerRow: 1, position: { x: 0, y: 0 } },
        { name: 'Right', rows: 1, seatsPerRow: 1, position: { x: 1000, y: 500 } },
      ],
    });

    const viewBox = seatmap.clientViewBox!;
    expect(viewBox.isControlledManually).toBe(false);
    expect(viewBox.x).toBeLessThan(DEFAULT_SECTION_ORIGIN_OFFSET);
    expect(viewBox.x + viewBox.width).toBeGreaterThan(1000 + DEFAULT_SECTION_ORIGIN_OFFSET);
    expect(viewBox.y + viewBox.height).toBeGreaterThan(500 + DEFAULT_SECTION_ORIGIN_OFFSET);
  });

  it('reports per-section statistics', () => {
    const { stats } = compile({
      schema: { name: 'Main' },
      sections: [
        { name: 'Stalls', rows: 2, seatsPerRow: 4 },
        { name: 'Standing', type: 'ga' },
      ],
    });

    expect(stats.sections).toBe(2);
    expect(stats.rows).toBe(2);
    expect(stats.seats).toBe(8);
    expect(stats.perSection).toEqual([
      { name: 'Stalls', type: 'grid', rows: 2, seats: 8 },
      { name: 'Standing', type: 'ga', rows: 0, seats: 0 },
    ]);
  });

  it('carries seat flags and arc rotation through to the payload', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [
        {
          name: 'Balcony',
          type: 'arc',
          rows: 1,
          seatsPerRow: 1,
          radius: 100,
          flags: [{ row: '1', seats: ['1'], accessible: true, marked: true }],
        },
      ],
    });

    const seat = seatmap.seats[0]!;
    expect(seat.isAccessible).toBe(true);
    expect(seat.isMarked).toBe(true);
    expect(seat.isHidden).toBeUndefined();
    expect(seat.angle).toBe(0);
  });

  it('emits a stage as a standalone OBJECT shape with no sector link', () => {
    const { seatmap, stats } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 1, seatsPerRow: 1 }],
      shapes: [{ type: 'stage', position: { x: -300, y: -400 } }],
    });

    expect(stats.shapes).toBe(1);
    expect(seatmap.sectors).toHaveLength(1);

    const stage = seatmap.shapes?.[0] as SimpleShapeDTO | undefined;
    expect(stage?.type).toBe('shape');
    expect(stage?.purpose).toBe('OBJECT');
    expect(stage?.groupOfSeatsGuid).toBeUndefined();
    expect(stage?.shapeType).toBe('RECT');
    expect(stage?.text).toBe('STAGE');
    expect(stage?.left).toBe(-300);
    expect(stage?.top).toBe(-400);
    expect(stage?.width).toBe(600);
    expect(stage?.height).toBe(120);
  });

  it('orders GA shapes before standalone shapes without colliding ids', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'FZ1', type: 'ga' }],
      shapes: [{ type: 'stage' }, { type: 'label', text: 'Entrance' }],
    });

    const shapes = seatmap.shapes ?? [];
    expect(shapes.map((shape) => shape.order)).toEqual([0, 1, 2]);
    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(3);
    expect((shapes[0] as SimpleShapeDTO).purpose).toBe('GA');
    expect((shapes[1] as SimpleShapeDTO).purpose).toBe('OBJECT');
    expect(shapes[2]?.type).toBe('label');
  });

  it('grows the view box to contain standalone shapes', () => {
    const withoutStage = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 1, seatsPerRow: 1 }],
    });
    const withStage = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 1, seatsPerRow: 1 }],
      shapes: [{ type: 'stage', position: { x: 0, y: -900 } }],
    });

    expect(withStage.seatmap.clientViewBox!.y).toBeLessThan(withoutStage.seatmap.clientViewBox!.y);
    expect(withStage.seatmap.clientViewBox!.y).toBeLessThanOrEqual(-900);
  });

  it('passes outline settings onto the sector', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [
        {
          name: 'Stalls',
          rows: 1,
          seatsPerRow: 1,
          outline: { mode: 'AUTO', padding: { top: 10, left: 5 } },
          title: { position: 'TOP', fontScale: 3 },
          rowLabels: { left: true, right: true },
        },
      ],
    });

    const sector = seatmap.sectors[0]!;
    expect(sector.outlineMode).toBe('AUTO');
    expect(sector.outlinePaddingTop).toBe(10);
    expect(sector.outlinePaddingLeft).toBe(5);
    expect(sector.outlinePaddingRight).toBeUndefined();
    expect(sector.titlePosition).toBe('TOP');
    expect(sector.titleFontScale).toBe(3);
    expect(sector.rlLeft).toBe(true);
    expect(sector.rlRight).toBe(true);
    expect(sector.rlCenter).toBe(false);
  });

  it('omits the vector background when the spec has no underlay', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 1, seatsPerRow: 1 }],
    });

    expect(seatmap.vectorBackground).toBeUndefined();
  });

  it('emits the underlay as the vector background', () => {
    const svg = '<svg viewBox="0 0 960 480"></svg>';
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 1, seatsPerRow: 1 }],
      underlay: { svg },
    });

    const background = seatmap.vectorBackground!;
    expect(background.backgroundSvg).toBe(svg);
    expect(background.viewBox).toEqual({ x: 0, y: 0, width: 960, height: 480 });
    expect(background).toMatchObject({ x: 0, y: 0, width: 960, height: 480, scale: 2 });
  });

  it('grows the client viewbox to cover the underlay', () => {
    const { seatmap } = compile({
      schema: { name: 'Main' },
      sections: [{ name: 'Stalls', rows: 1, seatsPerRow: 1 }],
      underlay: {
        svg: '<svg viewBox="0 0 10 10"></svg>',
        position: { x: -2000, y: -1000 },
        width: 4000,
        height: 2000,
      },
    });

    const viewBox = seatmap.clientViewBox!;
    expect(viewBox.x).toBeLessThanOrEqual(-2000);
    expect(viewBox.y).toBeLessThanOrEqual(-1000);
    expect(viewBox.x + viewBox.width).toBeGreaterThanOrEqual(2000);
    expect(viewBox.y + viewBox.height).toBeGreaterThanOrEqual(1000);
  });
});
