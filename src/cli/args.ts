import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  multiple?: boolean;
}

export type OptionSpecs = Record<string, OptionSpec>;

export type OptionValue = string | boolean | string[] | boolean[] | undefined;

export type OptionValues = Record<string, OptionValue>;

export const GLOBAL_OPTIONS: OptionSpecs = {
  profile: { type: 'string' },
  url: { type: 'string' },
  org: { type: 'string' },
  json: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean' },
  verbose: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
};

export interface ParsedArgs {
  positionals: string[];
  values: OptionValues;
}

export function parseCommandArgs(argv: readonly string[], options: OptionSpecs = {}): ParsedArgs {
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: { ...GLOBAL_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
    return { positionals: parsed.positionals, values: parsed.values as OptionValues };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(message, 'Run "seatmap help" to see available commands and flags.');
  }
}

export function stringOption(values: OptionValues, name: string): string | undefined {
  const value = values[name];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === 'string' ? last : undefined;
  }
  return undefined;
}

export function boolOption(values: OptionValues, name: string): boolean {
  const value = values[name];
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

export function numberOption(values: OptionValues, name: string): number | undefined {
  const raw = stringOption(values, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`--${name} expects a number, got "${raw}"`);
  }
  return parsed;
}

export function requiredString(values: OptionValues, name: string): string {
  const value = stringOption(values, name);
  if (value === undefined || value.length === 0) {
    throw new UsageError(`--${name} is required`);
  }
  return value;
}

export function positional(positionals: readonly string[], index: number, name: string): string {
  const value = positionals[index];
  if (value === undefined || value.length === 0) {
    throw new UsageError(`Missing required argument <${name}>`);
  }
  return value;
}

export function positionalNumber(
  positionals: readonly string[],
  index: number,
  name: string,
): number {
  const raw = positional(positionals, index, name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new UsageError(`<${name}> expects an integer, got "${raw}"`);
  }
  return parsed;
}
