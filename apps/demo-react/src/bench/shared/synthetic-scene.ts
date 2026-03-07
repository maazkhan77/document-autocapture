import type { Quad } from '@document-autocapture/core-engine';

/**
 * Draw a synthetic document rectangle on a canvas context.
 * Returns the quad representing the document corners.
 * Applies frame-based jitter to simulate camera motion.
 */
export function drawSyntheticDocument(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  frameIndex: number,
): Quad {
  const t = frameIndex / 12;
  const jitterX = Math.sin(t) * 6;
  const jitterY = Math.cos(t) * 4;

  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, width, height);

  const left = width * 0.14 + jitterX;
  const top = height * 0.1 + jitterY;
  const docWidth = width * 0.72;
  const docHeight = height * 0.78;

  ctx.fillStyle = '#d7dde6';
  ctx.fillRect(left, top, docWidth, docHeight);

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = Math.max(2, Math.round(width * 0.01));
  ctx.strokeRect(left, top, docWidth, docHeight);

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i += 1) {
    const y = top + 20 + i * ((docHeight - 40) / 12);
    ctx.beginPath();
    ctx.moveTo(left + 24, y);
    ctx.lineTo(left + docWidth - 24, y);
    ctx.stroke();
  }

  return {
    topLeft: { x: left, y: top },
    topRight: { x: left + docWidth, y: top },
    bottomRight: { x: left + docWidth, y: top + docHeight },
    bottomLeft: { x: left, y: top + docHeight },
  };
}
