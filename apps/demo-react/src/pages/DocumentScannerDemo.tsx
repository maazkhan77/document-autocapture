/**
 * DocumentScannerDemo — reference implementation showing how to build
 * a production-quality document capture UI using react-document-autocapture.
 *
 * This is NOT shipped inside the npm packages. It lives in the demo app
 * as a copy-and-adapt reference for integrators.
 *
 * Features demonstrated:
 * - Camera permission handling (prompt → denied → retry)
 * - Onboarding tips before scanning
 * - Real-time guidance messages with i18n support
 * - Animated document frame overlay
 * - Capture result preview with corner adjust
 * - ARIA accessibility via useGuidanceMessage
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  useDocumentAutoCapture,
  useGuidanceMessage,
  CornerAdjustModal,
} from 'react-document-autocapture';
import type { CaptureResult, ScannerConfig } from 'js-document-autocapture';

// ── Types ────────────────────────────────────────────────────────────────

type Phase = 'onboarding' | 'scanning' | 'preview' | 'permission-denied';

// ── Styles (inline for portability — replace with your design system) ───

const styles = {
  container: {
    maxWidth: 480,
    margin: '0 auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#1a1a2e',
    background: '#fafafa',
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 2px 24px rgba(0,0,0,0.08)',
  } as const,

  header: {
    padding: '16px 20px',
    background: '#1a1a2e',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 0.5,
  } as const,

  videoWrapper: {
    position: 'relative' as const,
    width: '100%',
    background: '#000',
    aspectRatio: '3 / 4',
    overflow: 'hidden',
  },

  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
  },

  frameOverlay: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none' as const,
  },

  frameRect: (isReady: boolean) => ({
    width: '80%',
    height: '70%',
    border: `3px solid ${isReady ? '#2ec4b6' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 12,
    transition: 'border-color 0.3s, box-shadow 0.3s',
    boxShadow: isReady ? '0 0 20px rgba(46,196,182,0.4)' : 'none',
  }),

  guidanceBanner: (isReady: boolean) => ({
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: '12px 16px',
    background: isReady
      ? 'linear-gradient(transparent, rgba(46,196,182,0.85))'
      : 'linear-gradient(transparent, rgba(0,0,0,0.7))',
    color: '#fff',
    fontSize: 15,
    fontWeight: 500,
    textAlign: 'center' as const,
    transition: 'background 0.3s',
  }),

  controls: {
    display: 'flex',
    gap: 8,
    padding: '12px 20px',
    justifyContent: 'center',
  } as const,

  btn: (variant: 'primary' | 'secondary' | 'danger') => ({
    padding: '10px 20px',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    ...(variant === 'primary' && { background: '#2ec4b6', color: '#fff' }),
    ...(variant === 'secondary' && { background: '#e8e8e8', color: '#1a1a2e' }),
    ...(variant === 'danger' && { background: '#ff6b6b', color: '#fff' }),
  }),

  onboarding: {
    padding: '32px 24px',
    textAlign: 'center' as const,
  },

  tipList: {
    listStyle: 'none',
    padding: 0,
    margin: '20px 0',
    textAlign: 'left' as const,
  } as const,

  tipItem: {
    padding: '10px 0',
    fontSize: 14,
    borderBottom: '1px solid #eee',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as const,

  preview: {
    padding: 20,
    textAlign: 'center' as const,
  },

  previewImage: {
    maxWidth: '100%',
    borderRadius: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
  } as const,

  permDenied: {
    padding: '40px 24px',
    textAlign: 'center' as const,
  },

  badge: (ok: boolean) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: ok ? '#d4edda' : '#f8d7da',
    color: ok ? '#155724' : '#721c24',
    marginLeft: 6,
  }),
} as const;

// ── Onboarding tips ──────────────────────────────────────────────────────

const TIPS = [
  { icon: '💡', text: 'Ensure good, even lighting — avoid harsh shadows' },
  { icon: '📄', text: 'Place the document on a contrasting surface' },
  { icon: '📐', text: 'Keep the document fully visible in the frame' },
  { icon: '🤳', text: 'Hold your device steady with both hands' },
  { icon: '🔍', text: 'Make sure the camera lens is clean' },
];

// ── Component ────────────────────────────────────────────────────────────

export interface DocumentScannerDemoProps {
  config?: Partial<ScannerConfig>;
  onCapture?: (result: CaptureResult) => void;
}

export function DocumentScannerDemo({ config, onCapture }: DocumentScannerDemoProps) {
  const [phase, setPhase] = useState<Phase>('onboarding');
  const [capturedResult, setCapturedResult] = useState<CaptureResult | null>(null);
  const [cornerModalOpen, setCornerModalOpen] = useState(false);
  const dataUrlRef = useRef('');

  const setBlobUrl = useCallback((blob: Blob) => {
    if (dataUrlRef.current) URL.revokeObjectURL(dataUrlRef.current);
    dataUrlRef.current = URL.createObjectURL(blob);
  }, []);

  // Revoke blob URL on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (dataUrlRef.current) URL.revokeObjectURL(dataUrlRef.current);
    };
  }, []);

  const scannerConfig: ScannerConfig = {
    autoCapture: true,
    quality: 'balanced',
    detection: 'auto',
    debugOverlay: 'off',
    ...config,
  };

  const {
    videoRef,
    start,
    stop,
    captureManual,
    isRunning,
    guidance,
    detection,
    lastCapture,
    error,
  } = useDocumentAutoCapture(scannerConfig);

  // Convert guidance code → human message + ARIA announcement
  const guidanceMessage = useGuidanceMessage(guidance);
  const isReady = guidance === 'READY';

  // Handle auto-capture results
  useEffect(() => {
    if (!lastCapture) return;
    setCapturedResult(lastCapture);
    setBlobUrl(lastCapture.blob);
    setPhase('preview');
    void stop();
    onCapture?.(lastCapture);
  }, [lastCapture, stop, onCapture]);

  // Handle camera start with permission error detection
  const handleStart = useCallback(async () => {
    try {
      setPhase('scanning');
      await start();
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.toLowerCase().includes('permission') || err.name === 'NotAllowedError')
      ) {
        setPhase('permission-denied');
      } else {
        setPhase('onboarding');
      }
    }
  }, [start]);

  const handleRetake = useCallback(async () => {
    setCapturedResult(null);
    if (dataUrlRef.current) URL.revokeObjectURL(dataUrlRef.current);
    dataUrlRef.current = '';
    setPhase('scanning');
    try {
      await start();
    } catch {
      setPhase('permission-denied');
    }
  }, [start]);

  const handleManualCapture = useCallback(async () => {
    try {
      const result = await captureManual();
      setCapturedResult(result);
      setBlobUrl(result.blob);
      setPhase('preview');
      void stop();
      onCapture?.(result);
    } catch {
      // Manual capture can fail if no document detected
    }
  }, [captureManual, stop, onCapture]);

  // ── Render phases ────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <div style={styles.header}>Document Scanner</div>

      {/* ONBOARDING */}
      {phase === 'onboarding' && (
        <div style={styles.onboarding}>
          <h2 style={{ fontSize: 20, margin: '0 0 4px' }}>Capture a Document</h2>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>
            For best results, follow these tips:
          </p>
          <ul style={styles.tipList}>
            {TIPS.map((tip, i) => (
              <li key={i} style={styles.tipItem}>
                <span style={{ fontSize: 20 }}>{tip.icon}</span>
                <span>{tip.text}</span>
              </li>
            ))}
          </ul>
          <button type="button" style={styles.btn('primary')} onClick={() => void handleStart()}>
            Start Scanning
          </button>
        </div>
      )}

      {/* SCANNING */}
      {phase === 'scanning' && (
        <>
          <div style={styles.videoWrapper}>
            <video ref={videoRef} style={styles.video} autoPlay muted playsInline />

            {/* Document frame overlay */}
            <div style={styles.frameOverlay}>
              <div style={styles.frameRect(isReady)} />
            </div>

            {/* Guidance banner */}
            <div style={styles.guidanceBanner(isReady)} role="status">
              {guidanceMessage || 'Initializing camera…'}
            </div>
          </div>

          <div style={{ padding: '8px 20px', fontSize: 12, color: '#888', textAlign: 'center' }}>
            {detection?.source ? (
              <>
                Detection: <strong>{detection.source}</strong>
                {detection.bestCandidate && (
                  <span style={styles.badge(true)}>
                    {(detection.bestCandidate.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </>
            ) : (
              'Waiting for detection…'
            )}
          </div>

          <div style={styles.controls}>
            <button
              type="button"
              style={styles.btn('secondary')}
              onClick={() => void handleManualCapture()}
              disabled={!isRunning}
            >
              Capture Now
            </button>
            <button
              type="button"
              style={styles.btn('danger')}
              onClick={() => {
                void stop();
                setPhase('onboarding');
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* PREVIEW */}
      {phase === 'preview' && capturedResult && (
        <div style={styles.preview}>
          <img src={dataUrlRef.current} alt="Captured document" style={styles.previewImage} />
          <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
            {capturedResult.width} × {capturedResult.height}
            <span style={styles.badge(capturedResult.warpTierUsed !== 'raw')}>
              warp: {capturedResult.warpTierUsed}
            </span>
          </div>
          <div style={{ ...styles.controls, marginTop: 12 }}>
            <button
              type="button"
              style={styles.btn('primary')}
              onClick={() => setCornerModalOpen(true)}
            >
              Adjust Corners
            </button>
            <button
              type="button"
              style={styles.btn('secondary')}
              onClick={() => void handleRetake()}
            >
              Retake
            </button>
          </div>

          <CornerAdjustModal
            open={cornerModalOpen}
            imageUrl={dataUrlRef.current}
            initialQuad={capturedResult.quad}
            onClose={() => setCornerModalOpen(false)}
            onConfirm={(adjustedQuad) => {
              setCornerModalOpen(false);
              // Integrators: re-warp with adjusted quad here
              console.log('Adjusted quad:', adjustedQuad);
            }}
          />
        </div>
      )}

      {/* PERMISSION DENIED */}
      {phase === 'permission-denied' && (
        <div style={styles.permDenied}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
          <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>Camera Access Required</h2>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 8px' }}>
            {error?.message ?? 'Camera permission was denied or the device has no camera.'}
          </p>
          <p style={{ fontSize: 12, color: '#999', margin: '0 0 20px' }}>
            Check your browser settings and allow camera access for this site, then try again.
          </p>
          <button type="button" style={styles.btn('primary')} onClick={() => void handleStart()}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
