import { describe, expect, it } from 'vitest';
import { parseSpec, DEFAULT_GA_SIZE, DEFAULT_SEAT_PITCH } from './spec.js';
import { UsageError } from '../cli/errors.js';
import type { ArcSectionSpec, GaSectionSpec, GridSectionSpec } from './spec.js';

const minimal = {
  schema: { name: 'Main bowl' },
  sections: [{ name: 'Stalls', rows: 4, seatsPerRow: 10 }],
};

describe('parseSpec', () => {
  it('accepts a minimal spec and defaults the section type to grid', () => {
    const spec = parseSpec(minimal);

    expect(spec.schema.name).toBe('Main bowl');
    expect(spec.venue).toBeUndefined();
    expect(spec.sections).toHaveLength(1);

    const section = spec.sections[0] as GridSectionSpec;
    expect(section.type).toBe('grid');
    expect(section.position).toEqual({ x: 0, y: 0 });
    expect(section.spacingX).toBe(DEFAULT_SEAT_PITCH);
    expect(section.spacingY).toBe(DEFAULT_SEAT_PITCH);
    expect(section.rowLabel).toBe('Row');
    expect(section.seatLabel).toBe('Seat');
  });

  it('parses a venue block', () => {
    const spec = parseSpec({
      ...minimal,
      venue: { name: 'Arena', address: 'Main street 1', lat: 56.9, lng: 24.1 },
    });

    expect(spec.venue).toEqual({
      name: 'Arena',
      address: 'Main street 1',
      lat: 56.9,
      lng: 24.1,
    });
  });

  it('defaults arc geometry', () => {
    const spec = parseSpec({
      schema: { name: 'S' },
      sections: [{ name: 'Balcony', type: 'arc', rows: 2, seatsPerRow: 8, radius: 400 }],
    });

    const section = spec.sections[0] as ArcSectionSpec;
    expect(section.arcDegrees).toBe(90);
    expect(section.rowSpacing).toBe(DEFAULT_SEAT_PITCH);
    expect(section.facing).toBe('in');
  });

  it('defaults GA geometry', () => {
    const spec = parseSpec({
      schema: { name: 'S' },
      sections: [{ name: 'Pit', type: 'ga' }],
    });

    const section = spec.sections[0] as GaSectionSpec;
    expect(section.shapeType).toBe('RECT');
    expect(section.width).toBe(DEFAULT_GA_SIZE);
    expect(section.height).toBe(DEFAULT_GA_SIZE);
  });

  it('rejects a missing schema name', () => {
    expect(() => parseSpec({ sections: minimal.sections })).toThrow(UsageError);
  });

  it('rejects an empty section list', () => {
    expect(() => parseSpec({ schema: { name: 'S' }, sections: [] })).toThrow(/at least one/);
  });

  it('rejects duplicate section names', () => {
    expect(() =>
      parseSpec({
        schema: { name: 'S' },
        sections: [
          { name: 'A', rows: 1, seatsPerRow: 1 },
          { name: 'A', rows: 1, seatsPerRow: 1 },
        ],
      }),
    ).toThrow(/duplicate section name/);
  });

  it('rejects non-positive row and seat counts', () => {
    expect(() =>
      parseSpec({ schema: { name: 'S' }, sections: [{ name: 'A', rows: 0, seatsPerRow: 5 }] }),
    ).toThrow(/positive integer/);
    expect(() =>
      parseSpec({ schema: { name: 'S' }, sections: [{ name: 'A', rows: 2, seatsPerRow: 1.5 }] }),
    ).toThrow(/positive integer/);
  });

  it('reports the failing path in the message', () => {
    expect(() =>
      parseSpec({
        schema: { name: 'S' },
        sections: [{ name: 'A', rows: 1, seatsPerRow: 1, position: { x: 'left', y: 0 } }],
      }),
    ).toThrow(/sections\[0\]\.position\.x/);
  });

  it('rejects an unknown section type', () => {
    expect(() =>
      parseSpec({ schema: { name: 'S' }, sections: [{ name: 'A', type: 'hexagon' }] }),
    ).toThrow(/expected one of grid, arc, ga/);
  });

  it('rejects an unknown numbering format', () => {
    expect(() =>
      parseSpec({
        schema: { name: 'S' },
        sections: [
          { name: 'A', rows: 1, seatsPerRow: 1, numbering: { rows: { format: 'greek' } } },
        ],
      }),
    ).toThrow(/expected one of arabic, roman, letters/);
  });

  it('leaves the underlay undefined when the spec has none', () => {
    expect(parseSpec(minimal).underlay).toBeUndefined();
  });

  it('parses an underlay block', () => {
    const spec = parseSpec({
      ...minimal,
      underlay: {
        file: 'plan.svg',
        position: { x: -100, y: -50 },
        width: 1600,
        height: 900,
        scale: 1.5,
      },
    });

    expect(spec.underlay).toEqual({
      file: 'plan.svg',
      svg: undefined,
      x: -100,
      y: -50,
      width: 1600,
      height: 900,
      scale: 1.5,
    });
  });

  it('accepts inline svg content', () => {
    const spec = parseSpec({ ...minimal, underlay: { svg: '<svg viewBox="0 0 10 10"></svg>' } });

    expect(spec.underlay?.svg).toBe('<svg viewBox="0 0 10 10"></svg>');
    expect(spec.underlay?.file).toBeUndefined();
  });

  it('requires exactly one source for the underlay', () => {
    expect(() => parseSpec({ ...minimal, underlay: {} })).toThrow(/either "file" or "svg"/);
    expect(() => parseSpec({ ...minimal, underlay: { file: 'plan.svg', svg: '<svg />' } })).toThrow(
      /only one of "file" or "svg"/,
    );
  });

  it('rejects non-positive underlay dimensions', () => {
    expect(() => parseSpec({ ...minimal, underlay: { file: 'p.svg', scale: 0 } })).toThrow(
      /underlay\.scale/,
    );
    expect(() => parseSpec({ ...minimal, underlay: { file: 'p.svg', width: -1 } })).toThrow(
      /underlay\.width/,
    );
    expect(() => parseSpec({ ...minimal, underlay: { file: 'p.svg', height: 0 } })).toThrow(
      /underlay\.height/,
    );
  });
});
