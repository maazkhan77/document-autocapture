import type { CaptureResult } from 'js-document-autocapture';
import { useEffect, useRef, useState } from 'react';

type Quad = CaptureResult['quad'];
type Point = Quad[keyof Quad];

export interface CornerAdjustModalProps {
  open: boolean;
  imageUrl: string;
  initialQuad: Quad;
  autoRefined?: boolean;
  onClose: () => void;
  onConfirm: (quad: Quad) => void;
}

function defaultDragState() {
  return {
    corner: '' as keyof Quad | '',
    dragging: false,
  };
}

function drawCanvas(canvas: HTMLCanvasElement, image: HTMLImageElement, quad: Quad): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);

  // Semi-transparent overlay outside the quad (evenodd leaves quad interior clear)
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fill('evenodd');

  // Quad border
  ctx.strokeStyle = '#ff9f1c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();

  // Draw L-bracket corner handles
  const bracketLen = Math.max(18, Math.min(canvas.width, canvas.height) * 0.04);
  const corners: Array<{ point: Point; towardA: Point; towardB: Point }> = [
    { point: quad.topLeft, towardA: quad.topRight, towardB: quad.bottomLeft },
    { point: quad.topRight, towardA: quad.topLeft, towardB: quad.bottomRight },
    { point: quad.bottomRight, towardA: quad.bottomLeft, towardB: quad.topRight },
    { point: quad.bottomLeft, towardA: quad.bottomRight, towardB: quad.topLeft },
  ];

  for (const { point, towardA, towardB } of corners) {
    const dirAx = towardA.x - point.x;
    const dirAy = towardA.y - point.y;
    const lenA = Math.hypot(dirAx, dirAy) || 1;
    const dirBx = towardB.x - point.x;
    const dirBy = towardB.y - point.y;
    const lenB = Math.hypot(dirBx, dirBy) || 1;

    const armAx = point.x + (dirAx / lenA) * bracketLen;
    const armAy = point.y + (dirAy / lenA) * bracketLen;
    const armBx = point.x + (dirBx / lenB) * bracketLen;
    const armBy = point.y + (dirBy / lenB) * bracketLen;

    // White L-bracket with thick stroke
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(armAx, armAy);
    ctx.lineTo(point.x, point.y);
    ctx.lineTo(armBx, armBy);
    ctx.stroke();

    // Filled corner circle
    ctx.fillStyle = '#ff9f1c';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function nearestCorner(quad: Quad, point: Point): keyof Quad {
  const entries: Array<[keyof Quad, Point]> = [
    ['topLeft', quad.topLeft],
    ['topRight', quad.topRight],
    ['bottomRight', quad.bottomRight],
    ['bottomLeft', quad.bottomLeft],
  ];

  let best: keyof Quad = entries[0][0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [name, corner] of entries) {
    const distance = Math.hypot(corner.x - point.x, corner.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }

  return best;
}

export function CornerAdjustModal(props: CornerAdjustModalProps) {
  const { open, imageUrl, initialQuad, autoRefined = false, onClose, onConfirm } = props;
  const [quad, setQuad] = useState<Quad>(initialQuad);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragState = useRef(defaultDragState());
  const quadRef = useRef(quad);
  quadRef.current = quad;

  useEffect(() => {
    setQuad(initialQuad);
  }, [initialQuad]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      if (canvasRef.current) {
        drawCanvas(canvasRef.current, image, quadRef.current);
      }
    };
    image.onerror = () => {
      if (cancelled) return;
      imageRef.current = null;
    };
    image.src = imageUrl;

    return () => {
      cancelled = true;
      imageRef.current = null;
    };
  }, [open, imageUrl]);

  useEffect(() => {
    if (!open || !canvasRef.current || !imageRef.current) {
      return;
    }
    drawCanvas(canvasRef.current, imageRef.current, quad);
  }, [open, quad]);

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
      }}
    >
      <div style={{ background: '#fff', padding: 16, borderRadius: 10, width: 'min(90vw, 840px)' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Adjust corners</h3>
          {autoRefined ? (
            <span
              style={{
                borderRadius: 999,
                border: '1px solid rgba(33, 156, 121, 0.35)',
                background: 'rgba(45, 187, 143, 0.18)',
                color: '#115240',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 8px',
                fontFamily: 'monospace',
              }}
            >
              Auto refined
            </span>
          ) : null}
        </div>
        <p style={{ fontSize: 13, color: '#555', margin: '6px 0 10px' }}>
          Drag the orange circles to align with the document edges, then confirm.
        </p>
        <div
          style={{
            maxHeight: '68vh',
            overflow: 'auto',
            border: '1px solid #ddd',
            borderRadius: 8,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              touchAction: 'none',
            }}
            onPointerDown={(event) => {
              const canvas = canvasRef.current;
              if (!canvas) {
                return;
              }
              canvas.setPointerCapture(event.pointerId);
              const rect = canvas.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
              const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
              dragState.current = {
                dragging: true,
                corner: nearestCorner(quad, { x, y }),
              };
            }}
            onPointerMove={(event) => {
              if (!dragState.current.dragging) {
                return;
              }
              const canvas = canvasRef.current;
              if (!canvas) {
                return;
              }
              const rect = canvas.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
              const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
              const corner = dragState.current.corner;
              if (!corner) {
                return;
              }
              setQuad((prev) => ({
                ...prev,
                [corner]: { x, y },
              }));
            }}
            onPointerUp={(event) => {
              const canvas = canvasRef.current;
              if (canvas) canvas.releasePointerCapture(event.pointerId);
              dragState.current = defaultDragState();
            }}
          />
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm(quad);
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
