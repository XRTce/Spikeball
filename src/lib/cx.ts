/**
 * Joins class names, ignoring anything that is not a non-empty string.
 * Accepts `unknown` so `cond && css.x` works whatever `cond` is typed as.
 */
export function cx(...values: unknown[]): string {
  let out = '';
  for (const value of values) {
    if (typeof value !== 'string' || value === '') continue;
    out = out ? `${out} ${value}` : value;
  }
  return out;
}
