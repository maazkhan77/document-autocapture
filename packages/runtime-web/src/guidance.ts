import type { GuidanceCode } from '@document-autocapture/core-engine';

/**
 * Default English guidance messages for each guidance code.
 * Integrators can call `createGuidanceMessages()` with overrides for i18n.
 */
export const defaultGuidanceMessages: Readonly<Record<GuidanceCode, string>> = {
  DOCUMENT_NOT_FOUND: 'Point your camera at a document',
  TOO_DARK_OR_BRIGHT: 'Adjust lighting — too dark or too bright',
  REDUCE_GLARE: 'Reduce glare — tilt the document slightly',
  TOO_BLURRY: 'Image is blurry — hold your device steady',
  HOLD_STEADY: 'Hold steady…',
  MOVE_CLOSER: 'Move closer to the document',
  READY: 'Looking good — capturing…',
};

export type GuidanceMessages = Record<GuidanceCode, string>;

/**
 * Create a guidance message map, optionally overriding specific strings.
 * Use this for i18n — pass your translated strings as overrides.
 *
 * @example Spanish
 * ```ts
 * const messages = createGuidanceMessages({
 *   DOCUMENT_NOT_FOUND: 'Apunta la cámara al documento',
 *   HOLD_STEADY: 'Mantén firme…',
 *   READY: 'Capturando…',
 * });
 * ```
 */
export function createGuidanceMessages(
  overrides?: Partial<Record<GuidanceCode, string>>,
): GuidanceMessages {
  return { ...defaultGuidanceMessages, ...overrides };
}

/**
 * Resolve a guidance code to a human-readable message.
 *
 * @param code - The guidance code from the scanner
 * @param messages - Optional custom messages (defaults to English)
 * @returns Human-readable guidance string
 */
export function getGuidanceMessage(
  code: GuidanceCode | undefined,
  messages: GuidanceMessages = defaultGuidanceMessages,
): string {
  if (!code) return '';
  return messages[code] ?? code;
}

/**
 * Announce a guidance message to screen readers via an ARIA live region.
 * Creates the live region on first call and reuses it. Debounces rapid updates
 * to avoid overwhelming assistive technology.
 *
 * Safe to call in non-browser environments (no-ops silently).
 *
 * @param message - The text to announce
 * @param politeness - 'polite' (default) or 'assertive'
 */
let _ariaRegion: HTMLElement | null = null;
let _ariaTimer: ReturnType<typeof setTimeout> | undefined;

export function announceGuidance(
  message: string,
  politeness: 'polite' | 'assertive' = 'polite',
): void {
  if (typeof document === 'undefined') return;

  if (!_ariaRegion) {
    _ariaRegion = document.createElement('div');
    _ariaRegion.setAttribute('aria-live', politeness);
    _ariaRegion.setAttribute('aria-atomic', 'true');
    _ariaRegion.setAttribute('role', 'status');
    Object.assign(_ariaRegion.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    document.body.appendChild(_ariaRegion);
  }

  _ariaRegion.setAttribute('aria-live', politeness);

  // Debounce: wait 300ms before announcing to avoid rapid-fire updates
  if (_ariaTimer) clearTimeout(_ariaTimer);
  _ariaTimer = setTimeout(() => {
    if (_ariaRegion) {
      // Clear then set to force re-announcement
      _ariaRegion.textContent = '';
      requestAnimationFrame(() => {
        if (_ariaRegion) _ariaRegion.textContent = message;
      });
    }
  }, 300);
}

/**
 * Remove the ARIA live region from the DOM and clear any pending announcement.
 * Called internally by `destroy()`.
 */
export function cleanupGuidance(): void {
  if (_ariaTimer) {
    clearTimeout(_ariaTimer);
    _ariaTimer = undefined;
  }
  if (_ariaRegion) {
    _ariaRegion.remove();
    _ariaRegion = null;
  }
}
