import type { Quad } from '@document-autocapture/core-engine';
import type { CaptureResult, ScannerConfig } from 'js-document-autocapture';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { warpPerspectiveCpu } from '@document-autocapture/warp-cpu';
import {
  blobToImageData,
  clamp,
  computeImageDataLumaStats,
  fullImageQuad,
} from './helpers';
import type { CaptureEntry } from './types';

interface UseCaptureGalleryParams {
  lastCapture?: CaptureResult;
  scannerConfig: ScannerConfig;
  logEvent: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export function useCaptureGallery({
  lastCapture,
  scannerConfig,
  logEvent,
}: UseCaptureGalleryParams) {
  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);

  const capturesRef = useRef<CaptureEntry[]>([]);
  const seenCaptureRef = useRef<CaptureResult | undefined>(undefined);

  useEffect(() => {
    if (!lastCapture || seenCaptureRef.current === lastCapture) {
      return;
    }
    seenCaptureRef.current = lastCapture;
    const entry: CaptureEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      capture: lastCapture,
      imageUrl: URL.createObjectURL(lastCapture.blob),
    };
    logEvent(
      'info',
      `Capture (${lastCapture.captureDecisionSource}, ${lastCapture.detectorSourceAtCapture}, warp=${lastCapture.warpTierUsed})`,
    );
    setCaptures((prev) => {
      const next = [entry, ...prev];
      if (next.length > 8) {
        for (const removed of next.slice(8)) {
          URL.revokeObjectURL(removed.imageUrl);
          if (removed.adjustedUrl) {
            URL.revokeObjectURL(removed.adjustedUrl);
          }
        }
      }
      return next.slice(0, 8);
    });
    setSelectedCaptureId(entry.id);
  }, [lastCapture, logEvent]);

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  useEffect(() => {
    return () => {
      for (const entry of capturesRef.current) {
        URL.revokeObjectURL(entry.imageUrl);
        if (entry.adjustedUrl) {
          URL.revokeObjectURL(entry.adjustedUrl);
        }
      }
    };
  }, []);

  const activeCapture = useMemo(
    () => captures.find((capture) => capture.id === selectedCaptureId) ?? captures[0],
    [captures, selectedCaptureId],
  );

  const latestCaptureDecisionSource =
    lastCapture?.captureDecisionSource ?? activeCapture?.capture.captureDecisionSource ?? 'n/a';

  const selectedPreviewUrl = activeCapture?.adjustedUrl ?? activeCapture?.imageUrl ?? '';
  const selectedInitialQuad = activeCapture?.capture.quad ?? fullImageQuad(1000, 1400);

  const handleCornerConfirm = useCallback(
    (quad: Quad) => {
      if (!activeCapture) {
        setAdjustOpen(false);
        return;
      }
      void (async () => {
        try {
          const imageData = await blobToImageData(activeCapture.capture.blob);
          const warped = warpPerspectiveCpu({
            imageData,
            quad,
            outputWidth: imageData.width,
            outputHeight: imageData.height,
            budgetMs: 500,
          });
          if (!warped.ok || !warped.imageData) {
            logEvent('warn', 'Corner adjust warp failed; keeping original image');
            setAdjustOpen(false);
            return;
          }

          const warpedStats = computeImageDataLumaStats(warped.imageData, 4);
          const sourceStats = computeImageDataLumaStats(imageData, 8);
          const minExpectedVariance = Math.max(12, sourceStats.variance * 0.05);
          if (warpedStats.variance < minExpectedVariance || warpedStats.dynamicRange < 22) {
            logEvent('warn', 'Corner adjustment looked invalid; keeping original image');
            setAdjustOpen(false);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = warped.imageData.width;
          canvas.height = warped.imageData.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Missing canvas context');
          }
          ctx.putImageData(warped.imageData, 0, 0);
          const requestedMimeType = scannerConfig.captureMimeType ?? 'image/png';
          const exportMimeType =
            requestedMimeType === 'image/png' || requestedMimeType === 'image/jpeg' || requestedMimeType === 'image/webp'
              ? requestedMimeType
              : 'image/png';
          const exportQuality =
            exportMimeType === 'image/png'
              ? undefined
              : clamp(scannerConfig.captureQuality ?? 1, 0.1, 1);
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((out) => {
              if (!out) {
                reject(new Error('Could not serialize adjusted image'));
                return;
              }
              resolve(out);
            }, exportMimeType, exportQuality);
          });
          const adjustedUrl = URL.createObjectURL(blob);
          setCaptures((prev) =>
            prev.map((entry) => {
              if (entry.id !== activeCapture.id) {
                return entry;
              }
              if (entry.adjustedUrl) {
                URL.revokeObjectURL(entry.adjustedUrl);
              }
              return { ...entry, adjustedUrl };
            }),
          );
          logEvent('info', 'Corner adjustment applied');
        } catch (adjustError) {
          logEvent(
            'error',
            adjustError instanceof Error ? adjustError.message : 'Corner adjustment failed',
          );
        } finally {
          setAdjustOpen(false);
        }
      })();
    },
    [activeCapture, logEvent, scannerConfig.captureMimeType, scannerConfig.captureQuality],
  );

  const clearGallery = useCallback(() => {
    setCaptures((prev) => {
      for (const entry of prev) {
        URL.revokeObjectURL(entry.imageUrl);
        if (entry.adjustedUrl) {
          URL.revokeObjectURL(entry.adjustedUrl);
        }
      }
      return [];
    });
    setSelectedCaptureId('');
  }, []);

  return {
    captures,
    setCaptures,
    selectedCaptureId,
    setSelectedCaptureId,
    adjustOpen,
    setAdjustOpen,
    activeCapture,
    latestCaptureDecisionSource,
    selectedPreviewUrl,
    selectedInitialQuad,
    handleCornerConfirm,
    clearGallery,
  };
}
