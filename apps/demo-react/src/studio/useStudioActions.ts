import { useCallback, useEffect, useState } from 'react';
import type { ScannerConfig } from 'js-document-autocapture';
import type { useDocumentAutoCapture } from 'react-document-autocapture';
import { buildShareUrl } from '../app-logic';
import type { ScannerConfigState } from './useScannerConfigState';

type SdkResult = ReturnType<typeof useDocumentAutoCapture>;

interface StudioActionsInput {
  scannerConfig: ScannerConfig;
  configState: ScannerConfigState;
  captureManual: SdkResult['captureManual'];
  start: SdkResult['start'];
  stop: SdkResult['stop'];
  isRunning: boolean;
  capabilities: SdkResult['capabilities'];
  detection: SdkResult['detection'];
  stability: SdkResult['stability'];
  quality: SdkResult['quality'];
  guidance: SdkResult['guidance'];
  error: SdkResult['error'];
  captures: Array<{
    id: string;
    capture: {
      captureDecisionSource: string;
      detectorSourceAtCapture?: string;
      warpTierUsed?: string;
      elapsedMs?: number;
    };
    adjustedUrl?: string;
  }>;
  telemetry: unknown;
  events: unknown;
  logEvent: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export function useStudioActions(input: StudioActionsInput) {
  const [copyStatus, setCopyStatus] = useState('');

  const handleManualCapture = useCallback(async () => {
    try {
      await input.captureManual();
    } catch (captureError) {
      input.logEvent(
        'error',
        captureError instanceof Error ? captureError.message : 'Manual capture failed',
      );
    }
  }, [input.captureManual, input.logEvent]);

  const handleCopyConfig = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(input.scannerConfig, null, 2));
      setCopyStatus('Copied config');
      window.setTimeout(() => setCopyStatus(''), 1200);
    } catch {
      setCopyStatus('Copy failed');
      window.setTimeout(() => setCopyStatus(''), 1200);
    }
  }, [input.scannerConfig]);

  const handleCopyShareUrl = useCallback(async () => {
    const cs = input.configState;
    const url = buildShareUrl({
      currentSearch: window.location.search,
      origin: window.location.origin,
      path: window.location.pathname,
      detectorMode: cs.detectorMode,
      autoCapture: cs.autoCapture,
      debugOverlayLevel: cs.debugOverlayLevel,
      detectionWidth: cs.detectionWidth,
      graphMlEnabled: cs.graphMlEnabled,
      cocoBookEnabled: cs.cocoBookEnabled,
      cocoMinScore: cs.cocoMinScore,
      cocoUseAsPrimaryInMlMode: cs.cocoUseAsPrimaryInMlMode,
      cvContourEnabled: cs.cvContourEnabled,
      houghSecondaryEnabled: cs.houghSecondaryEnabled,
      mlFallbackEnabled: cs.mlFallbackEnabled,
      mlFallbackFrameStride: cs.mlFallbackFrameStride,
      mlFallbackTriggerConsecutiveMisses: cs.mlFallbackTriggerConsecutiveMisses,
      mlFallbackMinCvConfidence: cs.mlFallbackMinCvConfidence,
      mlRescueEnabled: cs.mlRescueEnabled,
      mlRescueFrameStride: cs.mlRescueFrameStride,
      postCaptureRefine: cs.postCaptureRefine,
      mlPipelineVersion: cs.mlPipelineVersion as 'v1-heuristic' | 'v2-graph',
      mlModelId: cs.mlModelId,
      mlInputSize: cs.mlInputSize,
      warpValidationLevel: cs.warpValidationLevel as 'standard' | 'strict',
    });
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('Copied share URL');
      window.setTimeout(() => setCopyStatus(''), 1200);
    } catch {
      setCopyStatus('Share copy failed');
      window.setTimeout(() => setCopyStatus(''), 1200);
    }
  }, [input.configState]);

  const handleExportSession = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      scannerConfig: input.scannerConfig,
      capabilities: input.capabilities,
      status: {
        isRunning: input.isRunning,
        guidance: input.guidance,
        error: input.error?.message,
      },
      latest: {
        detection: input.detection,
        stability: input.stability,
        quality: input.quality,
      },
      captures: input.captures.map((entry) => ({
        id: entry.id,
        captureDecisionSource: entry.capture.captureDecisionSource,
        detectorSourceAtCapture: entry.capture.detectorSourceAtCapture,
        warpTierUsed: entry.capture.warpTierUsed,
        elapsedMs: entry.capture.elapsedMs,
        hasAdjusted: Boolean(entry.adjustedUrl),
      })),
      telemetry: input.telemetry,
      events: input.events,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `document-autocapture-session-${Date.now()}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    input.logEvent('info', 'Session diagnostics exported');
  }, [
    input.scannerConfig,
    input.capabilities,
    input.isRunning,
    input.guidance,
    input.error,
    input.detection,
    input.stability,
    input.quality,
    input.captures,
    input.telemetry,
    input.events,
    input.logEvent,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        if (input.isRunning) {
          void handleManualCapture();
        }
        return;
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (input.isRunning) {
          void input.stop();
        } else {
          void input.start();
        }
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void handleCopyConfig();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [input.isRunning, handleManualCapture, handleCopyConfig, input.start, input.stop]);

  return {
    copyStatus,
    handleManualCapture,
    handleCopyConfig,
    handleCopyShareUrl,
    handleExportSession,
  };
}
