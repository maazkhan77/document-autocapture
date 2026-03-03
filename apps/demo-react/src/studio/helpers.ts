import type { Quad } from '@document-autocapture/core-engine';
import type { Dispatch, SetStateAction } from 'react';
import type { DebugOverlayLevel, DetectorMode } from '../app-logic';
import type { EventItem } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function drawQuad(
  ctx: CanvasRenderingContext2D,
  quad: Quad,
  stroke: string,
  lineWidth = 2.5,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();
}

export function fullImageQuad(width: number, height: number): Quad {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: width - 1, y: 0 },
    bottomRight: { x: width - 1, y: height - 1 },
    bottomLeft: { x: 0, y: height - 1 },
  };
}

export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not create canvas context');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function computeImageDataLumaStats(
  imageData: ImageData,
  stride = 4,
): { variance: number; dynamicRange: number } {
  const data = imageData.data;
  const step = Math.max(1, Math.floor(stride));
  let count = 0;
  let mean = 0;
  let m2 = 0;
  let minLuma = 255;
  let maxLuma = 0;

  for (let i = 0; i < data.length; i += 4 * step) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count += 1;
    const delta = luma - mean;
    mean += delta / count;
    m2 += delta * (luma - mean);
    if (luma < minLuma) minLuma = luma;
    if (luma > maxLuma) maxLuma = luma;
  }

  return {
    variance: count > 1 ? m2 / (count - 1) : 0,
    dynamicRange: Math.max(0, maxLuma - minLuma),
  };
}

export function appendLog(
  setEvents: Dispatch<SetStateAction<EventItem[]>>,
  level: EventItem['level'],
  message: string,
): void {
  const next: EventItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    level,
    message,
  };
  setEvents((prev) => [next, ...prev].slice(0, 40));
}

export function parseNumberParam(
  search: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = search.get(key);
  const value = raw ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, min, max);
}

export function parseIntParam(
  search: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = search.get(key);
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(clamp(value, min, max));
}

export function parseDetectorMode(value: string | null, fallback: DetectorMode): DetectorMode {
  if (value === 'cv' || value === 'hybrid' || value === 'ml') {
    return value;
  }
  return fallback;
}

export function parseBooleanParam(search: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = search.get(key);
  if (raw === null) {
    return fallback;
  }
  return raw !== '0';
}

export function parsePostCaptureRefine(
  search: URLSearchParams,
  fallback: 'off' | 'safe',
): 'off' | 'safe' {
  const raw = search.get('postCaptureRefine');
  if (raw === 'safe' || raw === 'off') {
    return raw;
  }
  return fallback;
}

export function parseDebugOverlayLevel(value: string | null): DebugOverlayLevel {
  if (value === 'off' || value === 'basic' || value === 'full') {
    return value;
  }
  return 'full';
}
