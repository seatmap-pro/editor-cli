import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { RefusedError } from './errors.js';

export interface ConfirmOptions {
  question: string;
  assumeYes: boolean;
  expected?: string;
}

export async function confirm(options: ConfirmOptions): Promise<void> {
  if (options.assumeYes) return;

  if (!stdin.isTTY) {
    throw new RefusedError(
      'Confirmation required but stdin is not a terminal.',
      'Re-run with --yes to confirm non-interactively.',
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (options.expected !== undefined) {
      const answer = await rl.question(
        `${options.question}\nType "${options.expected}" to confirm: `,
      );
      if (answer.trim() !== options.expected) {
        throw new RefusedError('Aborted: confirmation text did not match.');
      }
      return;
    }

    const answer = await rl.question(`${options.question} [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new RefusedError('Aborted by user.');
    }
  } finally {
    rl.close();
  }
}

const ENTER_KEYS = new Set(['\r', '\n']);
const BACKSPACE_KEYS = new Set(['\u007f', '\b']);
const INTERRUPT = '\u0003';

function readMasked(question: string): Promise<string> {
  stdout.write(`${question}: `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (ENTER_KEYS.has(char)) {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === INTERRUPT) {
          cleanup();
          stdout.write('\n');
          reject(new RefusedError('Aborted by user.'));
          return;
        }
        if (BACKSPACE_KEYS.has(char)) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}

export async function prompt(question: string, opts: { mask?: boolean } = {}): Promise<string> {
  if (!stdin.isTTY) {
    throw new RefusedError(
      `Cannot prompt for "${question}" because stdin is not a terminal.`,
      'Pass the value as a flag or environment variable instead.',
    );
  }

  if (opts.mask) {
    return (await readMasked(question)).trim();
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(`${question}: `)).trim();
  } finally {
    rl.close();
  }
}
