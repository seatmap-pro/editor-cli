import { readFileSync } from 'node:fs';

const FALLBACK_VERSION = '0.0.0';

export function packageVersion(): string {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    const version = (manifest as { version?: unknown }).version;
    return typeof version === 'string' ? version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
