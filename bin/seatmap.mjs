#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = join(here, '..', 'dist', 'main.js');

if (!existsSync(compiled)) {
  process.stderr.write('seatmap: not built yet. Run "yarn build" first.\n');
  process.exit(70);
}

await import(compiled);
