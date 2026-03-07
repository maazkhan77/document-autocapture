function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function deepRecordEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (isObject(av) && isObject(bv)) {
      if (!deepRecordEqual(av, bv)) {
        return false;
      }
      continue;
    }
    if (!Object.is(av, bv)) {
      return false;
    }
  }
  return true;
}

/** @deprecated Renamed to {@link deepRecordEqual}. */
export const shallowRecordEqual = deepRecordEqual;

export function normalizeConfig(config?: Record<string, unknown>): Record<string, unknown> {
  return config ?? {};
}
