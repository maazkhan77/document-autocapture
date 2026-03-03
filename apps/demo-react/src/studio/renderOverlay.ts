import type {
  DetectionResult,
  StabilityResult,
} from '@document-autocapture/core-engine';
import { clamp, drawQuad } from './helpers';
import type { DebugOverlayLevel } from '../app-logic';

interface RenderOverlayParams {
  canvas: HTMLCanvasElement;
  detectionWidth: number;
  videoWidth: number;
  videoHeight: number;
  debugOverlayLevel: DebugOverlayLevel;
  detection?: DetectionResult;
  stability?: StabilityResult;
}

export function renderDetectionOverlay({
  canvas,
  detectionWidth,
  videoWidth,
  videoHeight,
  debugOverlayLevel,
  detection,
  stability,
}: RenderOverlayParams): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const width = detectionWidth;
  const aspectRatio = videoWidth > 0 && videoHeight > 0 ? videoHeight / videoWidth : 1.4;
  canvas.width = width;
  canvas.height = Math.round(width * aspectRatio);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (debugOverlayLevel === 'off' || !detection) {
    return;
  }

  const primaryCandidate = detection.bestCandidate ?? detection.candidates[0];
  if (!primaryCandidate) {
    return;
  }

  if (debugOverlayLevel === 'full') {
    for (const candidate of detection.candidates.filter((candidate) => candidate !== primaryCandidate).slice(0, 4)) {
      drawQuad(ctx, candidate.quad, 'rgba(123, 97, 255, 0.35)', 1.6);
    }
  }

  const found = detection.status === 'found';
  const stable = found && Boolean(stability?.stable);
  const color = found ? (stable ? '#00e5a8' : '#ffaf46') : '#ff5b6e';
  drawQuad(ctx, primaryCandidate.quad, color, found ? 3 : 2.4);

  const score = primaryCandidate.score;
  const candidateSource = (primaryCandidate.source ?? detection.source ?? 'cv').toUpperCase();
  const label = found
    ? `${candidateSource} ${(score * 100).toFixed(1)}%`
    : `${candidateSource} ${(score * 100).toFixed(1)}% · ${detection.rejectionReason ?? 'rejected'}`;
  ctx.font = '600 12px "IBM Plex Mono", monospace';
  const pad = 8;
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + pad * 2;
  const boxHeight = 22;
  const boxX = clamp(primaryCandidate.quad.topLeft.x, 4, canvas.width - boxWidth - 4);
  const boxY = clamp(primaryCandidate.quad.topLeft.y - 28, 4, canvas.height - boxHeight - 4);
  ctx.fillStyle = 'rgba(7, 10, 18, 0.76)';
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = color;
  ctx.fillText(label, boxX + pad, boxY + 15);
}
