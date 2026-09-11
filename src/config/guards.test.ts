import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertMutationAllowed, isProductionTarget } from './guards.js';
import { RefusedError } from '../cli/errors.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seatmap-cli-guards-'));
  process.env.SEATMAP_CLI_CONFIG = join(dir, 'cli.json');
  delete process.env.SEATMAP_CLI_PRODUCTION_HOSTS;
});

afterEach(() => {
  delete process.env.SEATMAP_CLI_CONFIG;
  delete process.env.SEATMAP_CLI_PRODUCTION_HOSTS;
  rmSync(dir, { recursive: true, force: true });
});

describe('isProductionTarget', () => {
  it('treats seatmap.pro and its subdomains as production', () => {
    expect(isProductionTarget('https://seatmap.pro')).toBe(true);
    expect(isProductionTarget('https://editor.seatmap.pro')).toBe(true);
    expect(isProductionTarget('https://editor.seatmap.pro/api')).toBe(true);
  });

  it('does not treat an unrelated host or localhost as production', () => {
    expect(isProductionTarget('https://editor.example.com')).toBe(false);
    expect(isProductionTarget('https://booking.example.com')).toBe(false);
    expect(isProductionTarget('http://localhost:8080')).toBe(false);
  });

  it('honours extra hosts from the environment', () => {
    process.env.SEATMAP_CLI_PRODUCTION_HOSTS = 'tickets.example.com,*.customer.net';
    expect(isProductionTarget('https://tickets.example.com')).toBe(true);
    expect(isProductionTarget('https://a.customer.net')).toBe(true);
    expect(isProductionTarget('https://other.example.com')).toBe(false);
  });

  it('sees through a fully qualified trailing dot', () => {
    expect(isProductionTarget('https://seatmap.pro.')).toBe(true);
    expect(isProductionTarget('https://editor.seatmap.pro.')).toBe(true);
  });

  it('is not fooled by a lookalike suffix', () => {
    expect(isProductionTarget('https://notseatmap.pro')).toBe(false);
    expect(isProductionTarget('https://seatmap.pro.evil.test')).toBe(false);
  });
});

describe('assertMutationAllowed', () => {
  it('allows mutations against non-production targets', () => {
    expect(() =>
      assertMutationAllowed({
        baseUrl: 'https://editor.example.com',
        action: 'delete schema',
        force: false,
      }),
    ).not.toThrow();
  });

  it('blocks mutations against production without --force', () => {
    expect(() =>
      assertMutationAllowed({
        baseUrl: 'https://editor.seatmap.pro',
        action: 'delete schema',
        force: false,
      }),
    ).toThrow(RefusedError);
  });

  it('allows mutations against production with --force', () => {
    expect(() =>
      assertMutationAllowed({
        baseUrl: 'https://editor.seatmap.pro',
        action: 'delete schema',
        force: true,
      }),
    ).not.toThrow();
  });
});
