import {
  createScannerSession,
  type ScannerConfig,
  type ScannerSession,
} from '@document-autocapture/runtime-web';
import { defaultMlModelBaseUrl } from './model-base-url';

/**
 * Create a document-autocapture scanner session.
 *
 * @example Minimal (sensible defaults)
 * ```ts
 * const scanner = createScanner();
 * ```
 *
 * @example Custom
 * ```ts
 * const scanner = createScanner({
 *   detection: 'ml',
 *   quality: 'high',
 *   cocoSsd: false,
 *   webglWarp: true,
 *   autoCapture: true,
 *   debug: true,
 * });
 * ```
 */
export function createScanner(config: Partial<ScannerConfig> = {}): ScannerSession {
  if (config.mlModelBaseUrl !== undefined) {
    return createScannerSession(config);
  }
  return createScannerSession({
    ...config,
    mlModelBaseUrl: defaultMlModelBaseUrl(),
  });
}

// ── Re-exports ──────────────────────────────────────────────────────────

export { detectCapabilities, selectExecutionMode } from '@document-autocapture/runtime-web';

export {
  defaultGuidanceMessages,
  createGuidanceMessages,
  getGuidanceMessage,
  announceGuidance,
} from '@document-autocapture/runtime-web';

export type {
  Capabilities,
  CaptureResult,
  Detection,
  GuidanceMessages,
  Quality,
  ScannerConfig,
  ScannerEventMap,
  ScannerEventName,
  ScannerSession,
  WarpTierUsed,
} from '@document-autocapture/runtime-web';
