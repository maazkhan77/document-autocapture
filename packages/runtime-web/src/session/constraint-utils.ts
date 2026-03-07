/**
 * Pure helpers for merging `MediaTrackConstraints` when composing
 * default + user-provided camera constraints.
 */

/** @internal */
export function defaultOpenCvScriptUrl(): string {
  if (typeof window === 'undefined') {
    return '/opencv.js';
  }
  try {
    return new URL('opencv.js', window.location.href).toString();
  } catch {
    return '/opencv.js';
  }
}

function isConstraintRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConstraintValue<T>(base: T | undefined, override: T | undefined): T | undefined {
  if (override === undefined) {
    return base;
  }
  if (isConstraintRecord(base) && isConstraintRecord(override)) {
    return { ...base, ...override } as T;
  }
  return override;
}

/** Deep-merge two `MediaTrackConstraints` objects for width/height/frameRate/aspectRatio. */
export function mergeVideoConstraints(
  base: MediaTrackConstraints | undefined,
  override: MediaTrackConstraints | undefined,
): MediaTrackConstraints | undefined {
  if (!base && !override) {
    return undefined;
  }
  const safeBase = base ?? {};
  const safeOverride = override ?? {};
  return {
    ...safeBase,
    ...safeOverride,
    width: mergeConstraintValue(safeBase.width, safeOverride.width),
    height: mergeConstraintValue(safeBase.height, safeOverride.height),
    frameRate: mergeConstraintValue(safeBase.frameRate, safeOverride.frameRate),
    aspectRatio: mergeConstraintValue(safeBase.aspectRatio, safeOverride.aspectRatio),
  };
}
