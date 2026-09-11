import { RefusedError } from '../cli/errors.js';
import { readConfig } from './profiles.js';

const BUILTIN_PRODUCTION_SUFFIXES = ['seatmap.pro'];

function normalizeHost(host: string): string {
  const lowered = host.toLowerCase();
  return lowered.endsWith('.') ? lowered.slice(0, -1) : lowered;
}

function hostOf(baseUrl: string): string {
  try {
    return normalizeHost(new URL(baseUrl).hostname);
  } catch {
    return normalizeHost(baseUrl);
  }
}

function patternsFromEnv(): string[] {
  const raw = process.env.SEATMAP_CLI_PRODUCTION_HOSTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function matches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === pattern;
}

export function productionPatterns(): string[] {
  let configured: string[] = [];
  try {
    configured = readConfig().productionHosts ?? [];
  } catch {
    configured = [];
  }
  return [
    ...BUILTIN_PRODUCTION_SUFFIXES.map((suffix) => `*.${suffix}`),
    ...BUILTIN_PRODUCTION_SUFFIXES,
    ...configured.map((entry) => entry.toLowerCase()),
    ...patternsFromEnv(),
  ];
}

export function isProductionTarget(baseUrl: string): boolean {
  const host = hostOf(baseUrl);
  return productionPatterns().some((pattern) => matches(host, pattern));
}

export interface GuardContext {
  baseUrl: string;
  action: string;
  force: boolean;
}

export function assertMutationAllowed(context: GuardContext): void {
  if (!isProductionTarget(context.baseUrl)) return;
  if (context.force) return;
  throw new RefusedError(
    `Refusing to ${context.action} against production target ${hostOf(context.baseUrl)}.`,
    'Re-run with --force if this is intentional.',
  );
}
