import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError, UsageError } from '../cli/errors.js';
import { warn } from '../cli/output.js';
import { underlayWarnings } from './underlay.js';
import type { BuildSpec } from './spec.js';

export interface ReadSpecOptions {
  allowModules?: boolean;
  allowStdin?: boolean;
  containWithin?: string;
}

export interface LoadUnderlayOptions {
  baseDir?: string;
  containWithin?: string;
}

export const STDIN_PATH = '-';

function assertContained(target: string, root: string, what: string): void {
  const step = relative(resolvePath(root), target);
  if (step === '' || step.startsWith('..') || isAbsolute(step)) {
    throw new UsageError(
      `${what} resolves outside ${root} and was refused.`,
      'Paths are restricted to the directory the server was started in.',
    );
  }
}

export async function readSpecFile(path: string, options: ReadSpecOptions = {}): Promise<unknown> {
  if (path === STDIN_PATH) {
    if (!options.allowStdin) {
      throw new UsageError('Reading a spec from stdin is not available here.');
    }
    return JSON.parse(readFileSync(0, 'utf8'));
  }

  const absolute = resolvePath(path);

  if (options.containWithin !== undefined) {
    assertContained(absolute, options.containWithin, path);
  }

  if (/\.(mjs|cjs|js)$/i.test(absolute)) {
    if (!options.allowModules) {
      throw new UsageError(
        `${path} is a JavaScript module and only JSON specs are accepted here.`,
        'Compile the module to JSON first, or pass the spec inline.',
      );
    }
    const module: unknown = await import(pathToFileURL(absolute).href);
    const record = module as { default?: unknown };
    if (record.default === undefined) {
      throw new UsageError(`${path} does not export a default spec object.`);
    }
    return record.default;
  }

  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new UsageError(`${path} is not valid JSON: ${error.message}`);
    }
    throw new CliError(
      `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadUnderlay(
  spec: BuildSpec,
  specPath: string,
  options: LoadUnderlayOptions = {},
): BuildSpec {
  const underlay = spec.underlay;
  if (!underlay || underlay.file === undefined) return spec;

  const baseDir =
    options.baseDir ?? (specPath === STDIN_PATH ? process.cwd() : dirname(resolvePath(specPath)));
  const svgPath = resolvePath(baseDir, underlay.file);

  if (options.containWithin !== undefined) {
    assertContained(svgPath, options.containWithin, `underlay ${underlay.file}`);
  }

  let svg: string;
  try {
    svg = readFileSync(svgPath, 'utf8');
  } catch (error) {
    throw new UsageError(
      `Cannot read underlay ${underlay.file}: ${error instanceof Error ? error.message : String(error)}`,
      'The path is resolved relative to the spec file.',
    );
  }

  for (const warning of underlayWarnings(svg)) warn(warning);

  return { ...spec, underlay: { ...underlay, file: undefined, svg } };
}
