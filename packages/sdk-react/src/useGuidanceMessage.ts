import { useEffect, useMemo, useRef } from 'react';
import {
  defaultGuidanceMessages,
  getGuidanceMessage,
  announceGuidance,
  type GuidanceMessages,
} from 'js-document-autocapture';

type GuidanceCode = keyof typeof defaultGuidanceMessages;

/**
 * React hook that converts a guidance code to a human-readable message
 * and announces changes to screen readers via ARIA live regions.
 *
 * @example
 * ```tsx
 * const { videoRef, guidance } = useDocumentAutoCapture({ autoCapture: true });
 * const message = useGuidanceMessage(guidance);
 * return <p>{message}</p>;
 * ```
 *
 * @example With i18n
 * ```tsx
 * const messages = createGuidanceMessages({ HOLD_STEADY: 'Mantén firme…' });
 * const message = useGuidanceMessage(guidance, { messages });
 * ```
 */
export function useGuidanceMessage(
  code: GuidanceCode | string | undefined,
  options?: {
    /** Custom message map (use createGuidanceMessages() for i18n) */
    messages?: GuidanceMessages;
    /** Announce to screen readers (default: true) */
    announce?: boolean;
    /** ARIA politeness level (default: 'polite') */
    politeness?: 'polite' | 'assertive';
  },
): string {
  const {
    messages = defaultGuidanceMessages,
    announce = true,
    politeness = 'polite',
  } = options ?? {};

  const message = useMemo(
    () => getGuidanceMessage(code as GuidanceCode | undefined, messages),
    [code, messages],
  );

  const prevCodeRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!announce || !message || code === prevCodeRef.current) return;
    prevCodeRef.current = code;
    announceGuidance(message, politeness);
  }, [code, message, announce, politeness]);

  return message;
}
