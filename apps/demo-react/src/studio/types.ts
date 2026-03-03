import type { CaptureResult } from 'js-document-autocapture';

export interface CaptureEntry {
  id: string;
  capture: CaptureResult;
  imageUrl: string;
  adjustedUrl?: string;
}

export interface EventItem {
  id: string;
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface TelemetrySample {
  ts: number;
  fps: number;
  detectionScore: number;
  qualityScore: number;
}

export interface QualityScoreSummary {
  avgFps: number;
  avgDetectionScore: number;
  avgQualityScore: number;
}
