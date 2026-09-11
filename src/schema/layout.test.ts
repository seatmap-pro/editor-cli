import { describe, expect, it } from 'vitest';
import { layoutArc, layoutGrid, sectionBounds, layoutSection } from './layout.js';
import { parseSpec, DEFAULT_SEAT_PITCH, DEFAULT_SECTION_ORIGIN_OFFSET } from './spec.js';
import type { ArcSectionSpec, GridSectionSpec } from './spec.js';

function gridSpec(overrides: Record<string, unknown> = {}): GridSectionSpec {
  const spec = parseSpec({
    schema: { name: 'S' },
    sections: [{ name: 'A', type: 'grid', rows: 2, seatsPerRow: 3, ...overrides }],
  });
  return spec.sections[0] as GridSectionSpec;
}

function arcSpec(overrides: Record<string, unknown> = {}): ArcSectionSpec {
  const spec = parseSpec({
    schema: { name: 'S' },
    sections: [{ name: 'A', type: 'arc', rows: 1, seatsPerRow: 3, radius: 100, ...overrides }],
  });
  return spec.sections[0] as ArcSectionSpec;
}

describe('layoutGrid', () => {
  it('places seats on the editor grid pitch', () => {
    const rows = layoutGrid(gridSpec());

    expect(rows).toHaveLength(2);
    expect(rows[0]?.rowNumber).toBe('1');
    expect(rows[0]?.seats.map((seat) => seat.x)).toEqual([
      DEFAULT_SECTION_ORIGIN_OFFSET,
      DEFAULT_SECTION_ORIGIN_OFFSET + DEFAULT_SEAT_PITCH,
      DEFAULT_SECTION_ORIGIN_OFFSET + DEFAULT_SEAT_PITCH * 2,
    ]);
    expect(rows[0]?.seats.every((seat) => seat.y === DEFAULT_SECTION_ORIGIN_OFFSET)).toBe(true);
    expect(rows[1]?.seats[0]?.y).toBe(DEFAULT_SECTION_ORIGIN_OFFSET + DEFAULT_SEAT_PITCH);
  });

  it('honours custom spacing', () => {
    const rows = layoutGrid(gridSpec({ spacing: { x: 40, y: 50 } }));
    expect(rows[0]?.seats[1]?.x).toBe(DEFAULT_SECTION_ORIGIN_OFFSET + 40);
    expect(rows[1]?.seats[0]?.y).toBe(DEFAULT_SECTION_ORIGIN_OFFSET + 50);
  });

  it('drops skipped seats and whole rows that end up empty', () => {
    const rows = layoutGrid(gridSpec({ skip: [{ row: '1', seats: ['2'] }, { row: '2' }] }));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowNumber).toBe('1');
    expect(rows[0]?.seats.map((seat) => seat.name)).toEqual(['1', '3']);
  });

  it('applies seat flags to the selected seats only', () => {
    const rows = layoutGrid(gridSpec({ flags: [{ row: '1', seats: ['1'], accessible: true }] }));

    expect(rows[0]?.seats[0]?.accessible).toBe(true);
    expect(rows[0]?.seats[1]?.accessible).toBeUndefined();
  });

  it('uses the configured numbering for rows and seats', () => {
    const rows = layoutGrid(
      gridSpec({
        numbering: { rows: { format: 'letters', from: 'A' }, seats: { from: '101' } },
      }),
    );

    expect(rows.map((row) => row.rowNumber)).toEqual(['A', 'B']);
    expect(rows[0]?.seats.map((seat) => seat.name)).toEqual(['101', '102', '103']);
  });
});

describe('layoutArc', () => {
  it('centres a single seat at the bottom of the arc', () => {
    const rows = layoutArc(arcSpec({ seatsPerRow: 1 }));
    const seat = rows[0]?.seats[0];

    expect(seat?.x).toBe(0);
    expect(seat?.y).toBe(100);
    expect(seat?.angle).toBe(0);
  });

  it('spreads seats evenly across the sweep', () => {
    const rows = layoutArc(arcSpec({ seatsPerRow: 3, arcDegrees: 90 }));
    const angles = rows[0]?.seats.map((seat) => seat.angle);

    expect(angles).toEqual([-45, 0, 45]);
    expect(rows[0]?.seats[1]?.x).toBe(0);
    expect(rows[0]?.seats[1]?.y).toBe(100);
  });

  it('pushes each successive row further from the focal point', () => {
    const rows = layoutArc(arcSpec({ rows: 2, seatsPerRow: 1, rowSpacing: 30 }));

    expect(rows[0]?.seats[0]?.y).toBe(100);
    expect(rows[1]?.seats[0]?.y).toBe(130);
  });

  it('flips the seat rotation when facing out', () => {
    const rows = layoutArc(arcSpec({ seatsPerRow: 1, facing: 'out' }));
    expect(rows[0]?.seats[0]?.angle).toBe(180);
  });
});

describe('sectionBounds', () => {
  it('covers all seats offset by the section position', () => {
    const spec = parseSpec({
      schema: { name: 'S' },
      sections: [
        { name: 'A', type: 'grid', rows: 1, seatsPerRow: 2, position: { x: 100, y: 200 } },
      ],
    });
    const bounds = sectionBounds(layoutSection(spec.sections[0]!));

    expect(bounds).toEqual({
      minX: 100 + DEFAULT_SECTION_ORIGIN_OFFSET,
      minY: 200 + DEFAULT_SECTION_ORIGIN_OFFSET,
      maxX: 100 + DEFAULT_SECTION_ORIGIN_OFFSET + DEFAULT_SEAT_PITCH,
      maxY: 200 + DEFAULT_SECTION_ORIGIN_OFFSET,
    });
  });

  it('uses the declared box for a GA section', () => {
    const spec = parseSpec({
      schema: { name: 'S' },
      sections: [{ name: 'GA', type: 'ga', position: { x: 10, y: 20 }, width: 300, height: 150 }],
    });
    const bounds = sectionBounds(layoutSection(spec.sections[0]!));

    expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 310, maxY: 170 });
  });
});
