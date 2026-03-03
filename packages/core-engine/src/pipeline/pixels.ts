import { clamp } from '../math';

export function rgbaToGrayscale(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  reuse?: Uint8ClampedArray,
): Uint8ClampedArray {
  const length = width * height;
  const out = reuse && reuse.length === length ? reuse : new Uint8ClampedArray(length);
  for (let i = 0; i < length; i += 1) {
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

export function blur3x3(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  reuse?: Uint8ClampedArray,
): Uint8ClampedArray {
  const length = width * height;
  const out = reuse && reuse.length === length ? reuse : new Uint8ClampedArray(length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        const py = y + ky;
        if (py < 0 || py >= height) {
          continue;
        }
        for (let kx = -1; kx <= 1; kx += 1) {
          const px = x + kx;
          if (px < 0 || px >= width) {
            continue;
          }
          sum += gray[py * width + px];
          count += 1;
        }
      }
      out[y * width + x] = Math.round(sum / Math.max(1, count));
    }
  }
  return out;
}

export interface SobelResult {
  magnitude: Float32Array;
  edgeMap: Uint8ClampedArray;
  edgeDensity: number;
}

export function sobelEdges(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  lowThreshold: number,
  highThreshold: number,
): SobelResult {
  const length = width * height;
  const magnitude = new Float32Array(length);
  const edgeMap = new Uint8ClampedArray(length);
  const strong = new Uint8Array(length);
  const weak = new Uint8Array(length);
  const stack = new Int32Array(length);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx =
        -gray[(y - 1) * width + (x - 1)] +
        gray[(y - 1) * width + (x + 1)] +
        -2 * gray[y * width + (x - 1)] +
        2 * gray[y * width + (x + 1)] +
        -gray[(y + 1) * width + (x - 1)] +
        gray[(y + 1) * width + (x + 1)];

      const gy =
        gray[(y - 1) * width + (x - 1)] +
        2 * gray[(y - 1) * width + x] +
        gray[(y - 1) * width + (x + 1)] +
        -gray[(y + 1) * width + (x - 1)] +
        -2 * gray[(y + 1) * width + x] +
        -gray[(y + 1) * width + (x + 1)];

      const mag = Math.hypot(gx, gy);
      magnitude[idx] = mag;
      if (mag >= highThreshold) {
        strong[idx] = 1;
      } else if (mag >= lowThreshold) {
        weak[idx] = 1;
      }
    }
  }

  let edgeCount = 0;
  let stackSize = 0;
  for (let i = 0; i < length; i += 1) {
    if (strong[i]) {
      stack[stackSize] = i;
      stackSize += 1;
    }
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const idx = stack[stackSize];
    if (edgeMap[idx] === 255) {
      continue;
    }
    edgeMap[idx] = 255;
    edgeCount += 1;

    const x = idx % width;
    const y = Math.floor(idx / width);
    for (let ny = y - 1; ny <= y + 1; ny += 1) {
      if (ny <= 0 || ny >= height - 1) {
        continue;
      }
      for (let nx = x - 1; nx <= x + 1; nx += 1) {
        if (nx <= 0 || nx >= width - 1) {
          continue;
        }
        const nIdx = ny * width + nx;
        if (weak[nIdx] && edgeMap[nIdx] === 0) {
          stack[stackSize] = nIdx;
          stackSize += 1;
        }
      }
    }
  }

  return {
    magnitude,
    edgeMap,
    edgeDensity: edgeCount / Math.max(1, width * height),
  };
}

export function laplacianVariance(gray: Uint8ClampedArray, width: number, height: number): number {
  let sum = 0;
  let sqSum = 0;
  let n = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = gray[y * width + x] * 4;
      const lap =
        center -
        gray[(y - 1) * width + x] -
        gray[(y + 1) * width + x] -
        gray[y * width + (x - 1)] -
        gray[y * width + (x + 1)];
      sum += lap;
      sqSum += lap * lap;
      n += 1;
    }
  }

  if (n === 0) {
    return 0;
  }

  const mean = sum / n;
  return sqSum / n - mean * mean;
}

function dilateBinary3x3(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  output: Uint8ClampedArray,
): void {
  output.fill(0);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let hit = false;
      for (let ky = -1; ky <= 1 && !hit; ky += 1) {
        const row = (y + ky) * width;
        for (let kx = -1; kx <= 1; kx += 1) {
          if (input[row + (x + kx)] > 0) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        output[y * width + x] = 255;
      }
    }
  }
}

function erodeBinary3x3(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  output: Uint8ClampedArray,
): void {
  output.fill(0);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let all = true;
      for (let ky = -1; ky <= 1 && all; ky += 1) {
        const row = (y + ky) * width;
        for (let kx = -1; kx <= 1; kx += 1) {
          if (input[row + (x + kx)] === 0) {
            all = false;
            break;
          }
        }
      }
      if (all) {
        output[y * width + x] = 255;
      }
    }
  }
}

export function closeBinaryMap(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  iterations = 1,
  reuse?: Uint8ClampedArray,
): Uint8ClampedArray {
  const length = width * height;
  const working = reuse && reuse.length === length ? reuse : new Uint8ClampedArray(length);
  const scratch = new Uint8ClampedArray(length);
  working.set(input);

  const rounds = Math.max(1, Math.floor(iterations));
  for (let i = 0; i < rounds; i += 1) {
    dilateBinary3x3(working, width, height, scratch);
    erodeBinary3x3(scratch, width, height, working);
  }
  return working;
}

export function sampleGridStdDev(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  step = 4,
): number {
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const safeY = clamp(y, 0, height - 1);
      const safeX = clamp(x, 0, width - 1);
      const v = gray[safeY * width + safeX] ?? 0;
      sum += v;
      sq += v * v;
      n += 1;
    }
  }
  if (n === 0) {
    return 0;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}
