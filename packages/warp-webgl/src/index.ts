import { computeHomography, nowMs, type Point, type Quad } from '@document-autocapture/core-engine';

export interface WebglWarpRequest {
  imageData: ImageData;
  quad: Quad;
  outputWidth: number;
  outputHeight: number;
  budgetMs?: number;
}

export interface WebglWarpResult {
  ok: boolean;
  canvas?: HTMLCanvasElement;
  elapsedMs: number;
  reason?: string;
}

interface WebglPipeline {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  texture: WebGLTexture;
  aPosition: number;
  uTexture: WebGLUniformLocation;
  uH: WebGLUniformLocation;
  uSrc: WebGLUniformLocation;
  uOut: WebGLUniformLocation;
}

let pipelineCache: WebglPipeline | undefined;

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(msg);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create shader program');
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(program) ?? 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(msg);
  }

  return program;
}

function buildPipeline(width: number, height: number): WebglPipeline {
  if (typeof document === 'undefined') {
    throw new Error('WebGL warp requires browser document context');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });
  if (!gl) {
    throw new Error('WebGL context unavailable');
  }

  const vertex = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

  const fragment = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform mat3 u_h;
uniform vec2 u_srcSize;
uniform vec2 u_outSize;

void main() {
  vec3 dest = vec3(v_uv.x * (u_outSize.x - 1.0), (1.0 - v_uv.y) * (u_outSize.y - 1.0), 1.0);
  vec3 src = u_h * dest;
  float w = max(src.z, 0.00001);
  vec2 srcUv = vec2(src.x / w / (u_srcSize.x - 1.0), src.y / w / (u_srcSize.y - 1.0));
  if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    gl_FragColor = texture2D(u_texture, vec2(srcUv.x, srcUv.y));
  }
}
`;

  const program = createProgram(gl, vertex, fragment);
  const positionBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!positionBuffer || !texture) {
    throw new Error('Failed to allocate WebGL buffers');
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.useProgram(program);
  const aPosition = gl.getAttribLocation(program, 'a_position');
  const uTexture = gl.getUniformLocation(program, 'u_texture');
  const uH = gl.getUniformLocation(program, 'u_h');
  const uSrc = gl.getUniformLocation(program, 'u_srcSize');
  const uOut = gl.getUniformLocation(program, 'u_outSize');

  if (aPosition < 0 || !uTexture || !uH || !uSrc || !uOut) {
    throw new Error('WebGL shader inputs unavailable');
  }

  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(uTexture, 0);

  return {
    canvas,
    gl,
    program,
    positionBuffer,
    texture,
    aPosition,
    uTexture,
    uH,
    uSrc,
    uOut,
  };
}

function getPipeline(width: number, height: number): WebglPipeline {
  if (!pipelineCache) {
    pipelineCache = buildPipeline(width, height);
  }
  if (pipelineCache.canvas.width !== width) {
    pipelineCache.canvas.width = width;
  }
  if (pipelineCache.canvas.height !== height) {
    pipelineCache.canvas.height = height;
  }
  return pipelineCache;
}

/**
 * Release cached WebGL resources (program, buffers, texture, context).
 * Call this when the warp pipeline is no longer needed to avoid GPU memory leaks.
 */
export function destroyWebglPipeline(): void {
  if (!pipelineCache) {
    return;
  }
  const { gl, program, positionBuffer, texture, canvas } = pipelineCache;
  gl.deleteTexture(texture);
  gl.deleteBuffer(positionBuffer);
  gl.deleteProgram(program);

  // Attempt to lose the WebGL context explicitly to free GPU memory.
  const loseCtx = gl.getExtension('WEBGL_lose_context');
  if (loseCtx) {
    loseCtx.loseContext();
  }

  // Shrink the canvas to release the backing store.
  canvas.width = 0;
  canvas.height = 0;

  pipelineCache = undefined;
}

export function warpPerspectiveWebGL(request: WebglWarpRequest): WebglWarpResult {
  const t0 = nowMs();
  const budgetMs = request.budgetMs ?? 50;

  if (typeof document === 'undefined') {
    return {
      ok: false,
      elapsedMs: 0,
      reason: 'WebGL warp requires browser document context',
    };
  }

  if (request.outputWidth <= 0 || request.outputHeight <= 0) {
    return {
      ok: false,
      elapsedMs: 0,
      reason: 'Invalid output dimensions',
    };
  }

  const srcPoints: Point[] = [
    request.quad.topLeft,
    request.quad.topRight,
    request.quad.bottomRight,
    request.quad.bottomLeft,
  ];
  const dstPoints: Point[] = [
    { x: 0, y: 0 },
    { x: request.outputWidth - 1, y: 0 },
    { x: request.outputWidth - 1, y: request.outputHeight - 1 },
    { x: 0, y: request.outputHeight - 1 },
  ];

  let homography: number[];
  try {
    homography = computeHomography(dstPoints, srcPoints);
  } catch (error) {
    return {
      ok: false,
      elapsedMs: nowMs() - t0,
      reason: error instanceof Error ? error.message : 'Failed to compute homography',
    };
  }

  let pipeline: WebglPipeline;
  try {
    pipeline = getPipeline(request.outputWidth, request.outputHeight);
  } catch (error) {
    return {
      ok: false,
      elapsedMs: nowMs() - t0,
      reason: error instanceof Error ? error.message : 'WebGL pipeline initialization failed',
    };
  }
  const canvas = pipeline.canvas;
  const gl = pipeline.gl;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pipeline.texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    request.imageData.width,
    request.imageData.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    request.imageData.data,
  );

  gl.viewport(0, 0, request.outputWidth, request.outputHeight);
  gl.useProgram(pipeline.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, pipeline.positionBuffer);
  gl.enableVertexAttribArray(pipeline.aPosition);
  gl.vertexAttribPointer(pipeline.aPosition, 2, gl.FLOAT, false, 0, 0);
  // GLSL mat3 is column-major; our homography array is row-major – transpose.
  const h = homography;
  const colMajor = new Float32Array([h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8]]);
  gl.uniformMatrix3fv(pipeline.uH, false, colMajor);
  gl.uniform2f(pipeline.uSrc, request.imageData.width, request.imageData.height);
  gl.uniform2f(pipeline.uOut, request.outputWidth, request.outputHeight);

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  // Ensure the draw is complete before consumers read/encode this canvas.
  gl.finish();

  const elapsedMs = nowMs() - t0;
  if (elapsedMs > budgetMs) {
    return {
      ok: false,
      elapsedMs,
      reason: 'WebGL warp budget exceeded',
    };
  }

  return {
    ok: true,
    canvas,
    elapsedMs,
  };
}
