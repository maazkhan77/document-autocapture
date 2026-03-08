import {
  createScanner,
  type Capabilities,
  type CaptureResult,
  type ScannerConfig,
  type ScannerEventMap,
  type ScannerSession,
} from 'js-document-autocapture';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { normalizeConfig, deepRecordEqual } from './config-utils';

type FrameProcessResult = ScannerEventMap['frame'];
type DetectionResult = FrameProcessResult['detection'];
type StabilityResult = FrameProcessResult['stability'];
type QualityResult = FrameProcessResult['quality'];
type GuidanceCode = FrameProcessResult['guidance'];

export interface UseDocumentAutoCaptureState {
  videoRef: (node: HTMLVideoElement | null) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  captureManual: () => Promise<CaptureResult>;
  isRunning: boolean;
  capabilities?: Capabilities;
  detection?: DetectionResult;
  stability?: StabilityResult;
  quality?: QualityResult;
  frame?: FrameProcessResult;
  guidance?: GuidanceCode;
  lastCapture?: CaptureResult;
  warning?: string;
  error?: Error;
}

interface HookState {
  isRunning: boolean;
  capabilities?: Capabilities;
  frame?: FrameProcessResult;
  lastCapture?: CaptureResult;
  warning?: string;
  error?: Error;
}

type HookAction =
  | { type: 'set-capabilities'; value?: Capabilities }
  | { type: 'set-frame'; value: FrameProcessResult }
  | { type: 'set-last-capture'; value: CaptureResult }
  | { type: 'set-warning'; value: string }
  | { type: 'set-error'; value?: Error }
  | { type: 'set-running'; value: boolean };

function reducer(state: HookState, action: HookAction): HookState {
  switch (action.type) {
    case 'set-capabilities':
      return { ...state, capabilities: action.value };
    case 'set-frame':
      return { ...state, frame: action.value };
    case 'set-last-capture':
      return { ...state, lastCapture: action.value };
    case 'set-warning':
      return { ...state, warning: action.value };
    case 'set-error':
      return { ...state, error: action.value };
    case 'set-running':
      return { ...state, isRunning: action.value };
    default:
      return state;
  }
}

export function useDocumentAutoCapture(config?: ScannerConfig): UseDocumentAutoCaptureState {
  const [state, dispatch] = useReducer(reducer, { isRunning: false });

  const videoRefObject = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<ScannerSession | undefined>(undefined);
  const lastAppliedConfigRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    const session = createScanner({
      ...(config ?? {}),
      videoElement: videoRefObject.current ?? undefined,
    });
    sessionRef.current = session;

    const unsubscribers = [
      session.on('capabilities', (value) => dispatch({ type: 'set-capabilities', value })),
      // Frame payload already includes detection, stability, quality, and guidance.
      session.on('frame', (value) => dispatch({ type: 'set-frame', value })),
      session.on('capture', (value) => dispatch({ type: 'set-last-capture', value })),
      session.on('warning', (value) => dispatch({ type: 'set-warning', value })),
      session.on('error', (value) => dispatch({ type: 'set-error', value })),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      void session.destroy().catch(() => undefined);
      sessionRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    const normalized = normalizeConfig(config as Record<string, unknown> | undefined);
    if (deepRecordEqual(lastAppliedConfigRef.current, normalized)) {
      return;
    }
    lastAppliedConfigRef.current = normalized;
    session.updateConfig({
      ...(config ?? {}),
      videoElement: videoRefObject.current ?? undefined,
    });
  }, [config]);

  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRefObject.current = node;
    if (sessionRef.current) {
      sessionRef.current.updateConfig({ videoElement: node ?? undefined });
    }
  }, []);

  const start = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }
    dispatch({ type: 'set-error', value: undefined });
    try {
      await sessionRef.current.start();
      dispatch({ type: 'set-capabilities', value: sessionRef.current.getCapabilities() });
      dispatch({ type: 'set-running', value: true });
    } catch (err) {
      dispatch({ type: 'set-running', value: false });
      dispatch({
        type: 'set-error',
        value: err instanceof Error ? err : new Error('Failed to start scanner'),
      });
      throw err;
    }
  }, []);

  const stop = useCallback(async () => {
    if (!sessionRef.current) {
      dispatch({ type: 'set-running', value: false });
      return;
    }
    try {
      await sessionRef.current.stop();
    } finally {
      dispatch({ type: 'set-running', value: false });
    }
  }, []);

  const captureManual = useCallback(async () => {
    if (!sessionRef.current) {
      throw new Error('Scanner session unavailable');
    }
    return sessionRef.current.captureManual();
  }, []);

  const detection = useMemo(
    () => state.frame?.detection as DetectionResult | undefined,
    [state.frame],
  );
  const stability = useMemo(
    () => state.frame?.stability as StabilityResult | undefined,
    [state.frame],
  );
  const quality = useMemo(() => state.frame?.quality as QualityResult | undefined, [state.frame]);
  const guidance = useMemo(() => state.frame?.guidance as GuidanceCode | undefined, [state.frame]);

  return {
    videoRef,
    start,
    stop,
    captureManual,
    isRunning: state.isRunning,
    capabilities: state.capabilities,
    detection,
    stability,
    quality,
    frame: state.frame,
    guidance,
    lastCapture: state.lastCapture,
    warning: state.warning,
    error: state.error,
  };
}
