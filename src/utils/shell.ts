/**
 * Quote a value so a POSIX shell treats it as a single literal argument.
 * Every value interpolated into a remote command must go through this.
 */
export function shellEscape(value: string | number): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
