import { computeHomography, type Point, type Quad } from '@docuscan/core-engine';

export interface CpuWarpRequest {
  imageData: ImageData;
  quad: Quad;
  outputWidth: number;
  outputHeight: number;
  budgetMs?: number;
}

export interface CpuWarpResult {
  ok: boolean;
  imageData?: ImageData;
  elapsedMs: number;
  reason?: string;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function shouldUseNearestNeighbor(
  outputWidth: number,
  outputHeight: number,
  budgetMs: number,
): boolean {
  const outputPixels = outputWidth * outputHeight;
  // Large captures under tight budget favor speed over interpolation quality.
  return outputPixels >= 3_000_000 && budgetMs <= 220;
}

export function warpPerspectiveCpu(request: CpuWarpRequest): CpuWarpResult {
  const t0 = now();
  const { imageData, quad, outputWidth, outputHeight } = request;
  const budgetMs = request.budgetMs ?? 200;
  const budgetGraceMs = 5;

  if (outputWidth <= 0 || outputHeight <= 0) {
    return {
      ok: false,
      elapsedMs: 0,
      reason: 'Invalid output dimensions',
    };
  }

  const srcPoints: Point[] = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  const dstPoints: Point[] = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ];

  let homography: number[];
  try {
    homography = computeHomography(dstPoints, srcPoints);
  } catch (error) {
    return {
      ok: false,
      elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
      reason: error instanceof Error ? error.message : 'Failed to solve homography',
    };
  }

  const out = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  const inData = imageData.data;
  const srcWidth = imageData.width;
  const srcHeight = imageData.height;

  const h00 = homography[0];
  const h01 = homography[1];
  const h02 = homography[2];
  const h10 = homography[3];
  const h11 = homography[4];
  const h12 = homography[5];
  const h20 = homography[6];
  const h21 = homography[7];
  const h22 = homography[8];
  const nearest = shouldUseNearestNeighbor(outputWidth, outputHeight, budgetMs);

  for (let y = 0; y < outputHeight; y += 1) {
    const rowOffset = y * outputWidth * 4;
    let nx = h01 * y + h02;
    let ny = h11 * y + h12;
    let den = h21 * y + h22;

    for (let x = 0; x < outputWidth; x += 1) {
      if ((x & 1023) === 0) {
        const elapsed = now() - t0;
        if (elapsed > budgetMs + budgetGraceMs) {
          return {
            ok: false,
            elapsedMs: elapsed,
            reason: 'CPU warp budget exceeded',
          };
        }
      }

      const idx = rowOffset + x * 4;
      const w = den;
      if (Math.abs(w) < 1e-8) {
        out[idx] = 0;
        out[idx + 1] = 0;
        out[idx + 2] = 0;
        out[idx + 3] = 255;
      } else {
        const srcX = nx / w;
        const srcY = ny / w;

        if (srcX < 0 || srcY < 0 || srcX >= srcWidth - 1 || srcY >= srcHeight - 1) {
          out[idx] = 0;
          out[idx + 1] = 0;
          out[idx + 2] = 0;
          out[idx + 3] = 255;
        } else {
          if (nearest) {
            const sx = Math.round(srcX);
            const sy = Math.round(srcY);
            const srcIdx = (sy * srcWidth + sx) * 4;
            out[idx] = inData[srcIdx];
            out[idx + 1] = inData[srcIdx + 1];
            out[idx + 2] = inData[srcIdx + 2];
            out[idx + 3] = inData[srcIdx + 3];
          } else {
            const x0 = srcX | 0;
            const y0 = srcY | 0;
            const x1 = x0 + 1;
            const y1 = y0 + 1;
            const dx = srcX - x0;
            const dy = srcY - y0;
            const invDx = 1 - dx;
            const invDy = 1 - dy;

            const row0 = y0 * srcWidth * 4;
            const row1 = y1 * srcWidth * 4;
            const idx00 = row0 + x0 * 4;
            const idx10 = row0 + x1 * 4;
            const idx01 = row1 + x0 * 4;
            const idx11 = row1 + x1 * 4;

            const w00 = invDx * invDy;
            const w10 = dx * invDy;
            const w01 = invDx * dy;
            const w11 = dx * dy;

            out[idx] = Math.round(
              inData[idx00] * w00 + inData[idx10] * w10 + inData[idx01] * w01 + inData[idx11] * w11,
            );
            out[idx + 1] = Math.round(
              inData[idx00 + 1] * w00 +
                inData[idx10 + 1] * w10 +
                inData[idx01 + 1] * w01 +
                inData[idx11 + 1] * w11,
            );
            out[idx + 2] = Math.round(
              inData[idx00 + 2] * w00 +
                inData[idx10 + 2] * w10 +
                inData[idx01 + 2] * w01 +
                inData[idx11 + 2] * w11,
            );
            out[idx + 3] = Math.round(
              inData[idx00 + 3] * w00 +
                inData[idx10 + 3] * w10 +
                inData[idx01 + 3] * w01 +
                inData[idx11 + 3] * w11,
            );
          }
        }
      }

      nx += h00;
      ny += h10;
      den += h20;
    }
  }

  const elapsedMs = now() - t0;
  return {
    ok: true,
    imageData: new ImageData(out, outputWidth, outputHeight),
    elapsedMs,
  };
}
