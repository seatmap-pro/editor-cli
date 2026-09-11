export type RowFormat = 'arabic' | 'roman' | 'letters';

export type VerticalDirection = 'toBottom' | 'toTop';

export type HorizontalDirection = 'toRight' | 'toLeft';

export interface RowNumbering {
  format?: RowFormat;
  from?: string;
  step?: number;
  direction?: VerticalDirection;
}

export interface SeatNumbering {
  from?: string;
  step?: number;
  direction?: HorizontalDirection;
}

interface ParsedPattern {
  prefix: string;
  numericValue: number;
  paddingWidth: number;
  isValid: boolean;
}

export function parsePattern(input: string): ParsedPattern {
  if (!input || input.length === 0) {
    return { prefix: '', numericValue: 1, paddingWidth: 1, isValid: false };
  }

  const match = input.match(/^(.*?)(\d+)$/);
  if (!match) {
    return { prefix: '', numericValue: 1, paddingWidth: 1, isValid: false };
  }

  const prefix = match[1] ?? '';
  const numericPart = match[2] ?? '';

  return {
    prefix,
    numericValue: parseInt(numericPart, 10),
    paddingWidth: numericPart.length,
    isValid: true,
  };
}

export function patternSequence(start: string, size: number, step = 1): string[] {
  const parsed = parsePattern(start);

  if (!parsed.isValid) {
    return Array.from({ length: size }, (_, index) => String(1 + index * step));
  }

  const result: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const value = parsed.numericValue + index * step;
    if (value > 0) {
      result.push(parsed.prefix + String(value).padStart(parsed.paddingWidth, '0'));
    }
  }
  return result;
}

const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

export function toRoman(value: number): string {
  if (value <= 0 || value > 3999) return '';
  let result = '';
  let remaining = value;
  for (const [amount, symbol] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}

export function fromRoman(roman: string): number {
  if (!roman) return 0;
  const upper = roman.toUpperCase();
  let result = 0;
  let previous = 0;
  for (let index = upper.length - 1; index >= 0; index -= 1) {
    const value = ROMAN_VALUES[upper[index] ?? ''];
    if (value === undefined) return 0;
    result += value < previous ? -value : value;
    previous = value;
  }
  return result;
}

export function isValidRoman(candidate: string): boolean {
  if (!candidate) return false;
  if (!/^[IVXLCDM]+$/i.test(candidate)) return false;
  return fromRoman(candidate) > 0;
}

export function romanSequence(start: string, size: number, step = 1): string[] {
  if (size <= 0 || step <= 0) return [];

  let startNumber: number;
  if (isValidRoman(start)) {
    startNumber = fromRoman(start);
  } else {
    startNumber = parseInt(start, 10);
    if (Number.isNaN(startNumber) || startNumber <= 0) startNumber = 1;
  }

  const result: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const value = startNumber + index * step;
    if (value > 0 && value <= 3999) result.push(toRoman(value));
  }
  return result;
}

export function incrementString(value: string): string {
  if (!value || value.length === 0) return 'A';

  const chars = value.split('');
  let position = chars.length - 1;

  while (position >= 0) {
    const charCode = (chars[position] ?? '').charCodeAt(0);
    let minCode: number;
    let nextChar: string;

    if (charCode >= 65 && charCode <= 90) {
      minCode = 65;
      nextChar = charCode === 90 ? 'A' : String.fromCharCode(charCode + 1);
    } else if (charCode >= 97 && charCode <= 122) {
      minCode = 97;
      nextChar = charCode === 122 ? 'a' : String.fromCharCode(charCode + 1);
    } else if (charCode >= 48 && charCode <= 57) {
      minCode = 48;
      nextChar = charCode === 57 ? '0' : String.fromCharCode(charCode + 1);
    } else {
      chars[position] = 'A';
      break;
    }

    chars[position] = nextChar;
    if (nextChar.charCodeAt(0) !== minCode) break;

    if (position === 0) {
      chars.unshift(minCode === 65 ? 'A' : minCode === 97 ? 'a' : '0');
      break;
    }
    position -= 1;
  }

  return chars.join('');
}

export function letterSequence(start: string, size: number, step = 1): string[] {
  if (!start || size <= 0 || step <= 0) return [];

  const result: string[] = [];
  let current = start;
  for (let index = 0; index < size; index += 1) {
    result.push(current);
    for (let iteration = 0; iteration < step; iteration += 1) {
      current = incrementString(current);
    }
  }
  return result;
}

function letterStartFrom(from: string): string {
  const numeric = parseInt(from, 10);
  if (!Number.isNaN(numeric) && numeric > 0 && numeric <= 26) {
    return String.fromCharCode(64 + numeric);
  }
  if (!Number.isNaN(numeric) && numeric > 26) return 'A';
  return from;
}

export function rowNames(count: number, numbering?: RowNumbering): string[] {
  if (count <= 0) return [];

  if (!numbering) {
    return Array.from({ length: count }, (_, index) => String(index + 1));
  }

  const step = numbering.step ?? 1;
  const from = numbering.from ?? '1';
  let sequence: string[];

  if (numbering.format === 'roman') {
    sequence = romanSequence(from, count, step);
  } else if (numbering.format === 'letters') {
    sequence = letterSequence(letterStartFrom(from), count, step);
  } else {
    sequence = patternSequence(from, count, step);
  }

  if (numbering.direction === 'toTop') sequence = sequence.slice().reverse();
  return sequence;
}

export function seatNames(count: number, numbering?: SeatNumbering): string[] {
  if (count <= 0) return [];

  if (!numbering) {
    return Array.from({ length: count }, (_, index) => String(index + 1));
  }

  const sequence = patternSequence(numbering.from ?? '1', count, numbering.step ?? 1);
  return numbering.direction === 'toLeft' ? sequence.slice().reverse() : sequence;
}
