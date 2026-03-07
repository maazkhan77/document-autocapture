import { expect, test } from '@playwright/test';

/**
 * Validates that the demo app loads and the camera pipeline initialises
 * on a physical Android device connected via CDP.
 *
 * Run with:
 *   npx playwright test --config apps/demo-react/playwright-android.config.ts e2e/android-validation.spec.ts
 */

test.describe('Android physical-device validation', () => {
  test('demo shell loads on device browser', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('document-autocapture')).toBeVisible({ timeout: 15_000 });
  });

  test('camera stream starts without crash', async ({ page }) => {
    await page.goto('/');
    // Wait for the scanner to auto-start and the video element to receive frames.
    const video = page.locator('video');
    await expect(video).toBeVisible({ timeout: 20_000 });

    // The video element should have a non-zero videoWidth once the camera provides frames.
    await page.waitForFunction(
      () => {
        const vid = document.querySelector('video');
        return vid && vid.videoWidth > 0;
      },
      { timeout: 30_000 },
    );
  });

  test('detection pipeline produces at least one frame result', async ({ page }) => {
    await page.goto('/');
    // The demo renders status text that changes once detection runs.
    // Wait for something other than "Initializing..." to appear.
    await expect(page.getByText(/(Aim|Hold|Move|Captured|No document|Error)/i)).toBeVisible({
      timeout: 45_000,
    });
  });

  test('manual capture produces a gallery entry', async ({ page }) => {
    await page.goto('/');

    // Wait for the scanner to be running
    const video = page.locator('video');
    await expect(video).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const vid = document.querySelector('video');
        return vid && vid.videoWidth > 0;
      },
      { timeout: 30_000 },
    );

    // Trigger manual capture via keyboard shortcut (Space)
    await page.keyboard.press('Space');

    // Verify a capture thumbnail appears in the gallery
    const galleryItem = page.locator(
      '[data-testid="capture-thumbnail"], .capture-gallery img, .gallery img',
    );
    await expect(galleryItem.first()).toBeVisible({ timeout: 10_000 });
  });
});
