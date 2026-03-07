import { describe, it, expect } from 'vitest';
import { defaultGuidanceMessages, createGuidanceMessages, getGuidanceMessage } from './guidance';

describe('guidance messages', () => {
  it('defaultGuidanceMessages covers all codes', () => {
    const codes = [
      'DOCUMENT_NOT_FOUND',
      'TOO_DARK_OR_BRIGHT',
      'REDUCE_GLARE',
      'TOO_BLURRY',
      'HOLD_STEADY',
      'MOVE_CLOSER',
      'READY',
    ] as const;

    for (const code of codes) {
      expect(defaultGuidanceMessages[code]).toBeDefined();
      expect(typeof defaultGuidanceMessages[code]).toBe('string');
      expect(defaultGuidanceMessages[code].length).toBeGreaterThan(0);
    }
  });

  it('createGuidanceMessages returns defaults when no overrides', () => {
    const messages = createGuidanceMessages();
    expect(messages).toEqual(defaultGuidanceMessages);
  });

  it('createGuidanceMessages merges overrides', () => {
    const messages = createGuidanceMessages({
      HOLD_STEADY: 'Mantén firme…',
      READY: 'Capturando…',
    });

    expect(messages.HOLD_STEADY).toBe('Mantén firme…');
    expect(messages.READY).toBe('Capturando…');
    // Unoverridden codes stay default
    expect(messages.MOVE_CLOSER).toBe(defaultGuidanceMessages.MOVE_CLOSER);
  });

  it('getGuidanceMessage resolves code to string', () => {
    expect(getGuidanceMessage('HOLD_STEADY')).toBe('Hold steady…');
    expect(getGuidanceMessage('READY')).toBe('Looking good — capturing…');
  });

  it('getGuidanceMessage returns empty for undefined', () => {
    expect(getGuidanceMessage(undefined)).toBe('');
  });

  it('getGuidanceMessage uses custom messages', () => {
    const custom = createGuidanceMessages({ READY: 'Go!' });
    expect(getGuidanceMessage('READY', custom)).toBe('Go!');
    expect(getGuidanceMessage('HOLD_STEADY', custom)).toBe('Hold steady…');
  });
});
