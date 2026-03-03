import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useDocumentAutoCapture } from './useDocumentAutoCapture';

describe('useDocumentAutoCapture', () => {
  it('returns stable control API shape for consumers', () => {
    let snapshot: ReturnType<typeof useDocumentAutoCapture> | undefined;

    function Probe() {
      snapshot = useDocumentAutoCapture({
        detectorMode: 'cv',
      });
      return null;
    }

    renderToString(<Probe />);
    expect(snapshot).toBeDefined();
    expect(typeof snapshot?.start).toBe('function');
    expect(typeof snapshot?.stop).toBe('function');
    expect(typeof snapshot?.captureManual).toBe('function');
    expect(typeof snapshot?.videoRef).toBe('function');
    expect(snapshot?.isRunning).toBe(false);
  });
});
