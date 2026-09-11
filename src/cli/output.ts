export interface OutputOptions {
  json: boolean;
  verbose: boolean;
}

const state: OutputOptions = { json: false, verbose: false };

export function configureOutput(options: Partial<OutputOptions>): void {
  if (options.json !== undefined) state.json = options.json;
  if (options.verbose !== undefined) state.verbose = options.verbose;
}

export function isJsonMode(): boolean {
  return state.json;
}

const useColor = (): boolean =>
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined && !state.json;

const ESC = '\u001b';

const paint = (code: string, text: string): string =>
  useColor() ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const bold = (text: string): string => paint('1', text);
export const dim = (text: string): string => paint('2', text);
export const red = (text: string): string => paint('31', text);
export const green = (text: string): string => paint('32', text);
export const yellow = (text: string): string => paint('33', text);

export function info(message: string): void {
  if (state.json) return;
  process.stdout.write(`${message}\n`);
}

export function detail(message: string): void {
  if (state.json || !state.verbose) return;
  process.stderr.write(`${dim(message)}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${yellow('warning')} ${message}\n`);
}

export function fail(message: string, hint?: string): void {
  process.stderr.write(`${red('error')} ${message}\n`);
  if (hint) process.stderr.write(`${dim(hint)}\n`);
}

export function success(message: string): void {
  if (state.json) return;
  process.stdout.write(`${green('ok')} ${message}\n`);
}

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export interface Column<T> {
  header: string;
  value: (row: T) => string;
}

export function table<T>(rows: readonly T[], columns: readonly Column<T>[]): void {
  if (rows.length === 0) {
    info(dim('(none)'));
    return;
  }

  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((row) => (row[index] ?? '').length)),
  );

  const line = (values: readonly string[]): string =>
    values
      .map((value, index) => value.padEnd(index === values.length - 1 ? 0 : (widths[index] ?? 0)))
      .join('  ')
      .trimEnd();

  info(bold(line(columns.map((column) => column.header))));
  for (const row of cells) info(line(row));
}

export function output<T>(rows: readonly T[], columns: readonly Column<T>[]): void {
  if (state.json) {
    emitJson(rows);
    return;
  }
  table(rows, columns);
}
