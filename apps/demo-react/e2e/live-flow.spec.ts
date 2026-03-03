import { expect, test } from '@playwright/test';

test.setTimeout(180000);

async function installMockCamera(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const width = 720;
    const height = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'fixed';
    canvas.style.left = '-99999px';
    canvas.style.top = '-99999px';

    const attachCanvas = () => {
      if (!document.body.contains(canvas)) {
        document.body.appendChild(canvas);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachCanvas, { once: true });
    } else {
      attachCanvas();
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('mock camera canvas context unavailable');
    }

    const draw = () => {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, width, height);

      const left = width * 0.16;
      const top = height * 0.08;
      const docWidth = width * 0.68;
      const docHeight = height * 0.82;

      ctx.fillStyle = '#d7dde6';
      ctx.fillRect(left, top, docWidth, docHeight);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 4;
      ctx.strokeRect(left, top, docWidth, docHeight);

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      for (let i = 0; i < 12; i += 1) {
        const y = top + 30 + i * ((docHeight - 60) / 12);
        ctx.beginPath();
        ctx.moveTo(left + 26, y);
        ctx.lineTo(left + docWidth - 26, y);
        ctx.stroke();
      }
    };
    draw();
    setInterval(draw, 33);

    const stream = canvas.captureStream(30);
    const base = navigator.mediaDevices ?? {};
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...base,
        getUserMedia: async () => stream,
      },
    });
  });
}

test('live flow: auto-capture reaches a renderable capture', async ({ page }) => {
  await installMockCamera(page);

  await page.goto(
    'http://127.0.0.1:4173/?detectorMode=cv&debugOverlayLevel=basic',
  );

  await expect(page.getByText(/Detection:\s*found/i)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.capture-panel img[alt="capture"]')).toBeVisible({ timeout: 30000 });
});

test('live flow: manual capture and corner adjust produce adjusted output', async ({ page }) => {
  await installMockCamera(page);

  await page.goto(
    'http://127.0.0.1:4173/?detectorMode=cv&debugOverlayLevel=basic&autoCapture=0',
  );

  await expect(page.getByText(/Detection:\s*found/i)).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByText(/Decision:\s*manual/i)).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Adjust Corners' }).click();
  await expect(page.getByRole('heading', { name: /Adjust corners/i })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.capture-panel img[alt="adjusted"]')).toBeVisible({ timeout: 15000 });
});
