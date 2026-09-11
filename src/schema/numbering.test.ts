import { describe, expect, it } from 'vitest';
import {
  fromRoman,
  incrementString,
  letterSequence,
  parsePattern,
  patternSequence,
  romanSequence,
  rowNames,
  seatNames,
  toRoman,
} from './numbering.js';

describe('parsePattern', () => {
  it('splits a trailing number from its prefix and keeps the padding width', () => {
    expect(parsePattern('A01')).toEqual({
      prefix: 'A',
      numericValue: 1,
      paddingWidth: 2,
      isValid: true,
    });
  });

  it('marks input without a trailing number as invalid', () => {
    expect(parsePattern('ROW').isValid).toBe(false);
    expect(parsePattern('').isValid).toBe(false);
  });
});

describe('patternSequence', () => {
  it('preserves prefix and zero padding', () => {
    expect(patternSequence('A01', 3)).toEqual(['A01', 'A02', 'A03']);
  });

  it('applies the step', () => {
    expect(patternSequence('10', 3, 5)).toEqual(['10', '15', '20']);
  });

  it('falls back to plain numbers when the start has no numeric part', () => {
    expect(patternSequence('ROW', 3)).toEqual(['1', '2', '3']);
  });
});

describe('roman numerals', () => {
  it('round-trips', () => {
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(1987)).toBe('MCMLXXXVII');
    expect(fromRoman('MCMLXXXVII')).toBe(1987);
  });

  it('returns an empty string outside the representable range', () => {
    expect(toRoman(0)).toBe('');
    expect(toRoman(4000)).toBe('');
  });

  it('generates a sequence from a roman or arabic start', () => {
    expect(romanSequence('I', 4)).toEqual(['I', 'II', 'III', 'IV']);
    expect(romanSequence('5', 3)).toEqual(['V', 'VI', 'VII']);
  });
});

describe('letter sequences', () => {
  it('increments within the alphabet', () => {
    expect(incrementString('A')).toBe('B');
    expect(incrementString('AZ')).toBe('BA');
  });

  it('grows a new character on wrap-around', () => {
    expect(incrementString('Z')).toBe('AA');
    expect(incrementString('ZZ')).toBe('AAA');
  });

  it('generates a stepped sequence', () => {
    expect(letterSequence('A', 4)).toEqual(['A', 'B', 'C', 'D']);
    expect(letterSequence('A', 3, 2)).toEqual(['A', 'C', 'E']);
  });
});

describe('rowNames', () => {
  it('numbers rows from one when no numbering is given', () => {
    expect(rowNames(3)).toEqual(['1', '2', '3']);
  });

  it('supports letters, including a numeric start', () => {
    expect(rowNames(3, { format: 'letters', from: 'A' })).toEqual(['A', 'B', 'C']);
    expect(rowNames(3, { format: 'letters', from: '3' })).toEqual(['C', 'D', 'E']);
  });

  it('supports roman numerals', () => {
    expect(rowNames(3, { format: 'roman', from: 'I' })).toEqual(['I', 'II', 'III']);
  });

  it('reverses when counting toward the top', () => {
    expect(rowNames(3, { from: '1', direction: 'toTop' })).toEqual(['3', '2', '1']);
  });
});

describe('seatNames', () => {
  it('numbers seats from one by default', () => {
    expect(seatNames(4)).toEqual(['1', '2', '3', '4']);
  });

  it('reverses when counting toward the left', () => {
    expect(seatNames(4, { direction: 'toLeft' })).toEqual(['4', '3', '2', '1']);
  });

  it('honours a custom start and step', () => {
    expect(seatNames(3, { from: '101', step: 2 })).toEqual(['101', '103', '105']);
  });
});
