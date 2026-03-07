/**
 * Playwright config addendum for testing against a **real** Android device
 * connected via ADB over the network or USB.
 *
 * Prerequisites:
 *   1. Chrome DevTools remote debugging is active on the device.
 *      - Enable "USB debugging" in Developer Options.
 *      - Run: adb forward tcp:9222 localabstract:chrome_devtools_remote
 *      - Or for wireless: adb tcpip 5555 && adb connect <device-ip>:5555
 *   2. The demo app dev-server is reachable from the device (same network).
 *      - Start with: pnpm --filter demo-react dev --host 0.0.0.0 --port 4173
 *   3. This config reads env vars to locate the device:
 *      - ANDROID_CDP_URL  (default: http://127.0.0.1:9222)
 *      - ANDROID_BASE_URL (default: http://<host-ip>:4173)
 *
 * Usage:
 *   ANDROID_CDP_URL=http://127.0.0.1:9222 \
 *   ANDROID_BASE_URL=http://192.168.1.42:4173 \
 *   npx playwright test --config apps/demo-react/playwright-android.config.ts
 */
import { defineConfig } from '@playwright/test';
import { networkInterfaces } from 'node:os';

function getHostLanIp(): string {
  for (const iface of Object.values(networkInterfaces()).flat()) {
    if (iface && !iface.internal && iface.family === 'IPv4') {
      return iface.address;
    }
  }
  return '127.0.0.1';
}

const cdpUrl = process.env.ANDROID_CDP_URL ?? 'http://127.0.0.1:9222';
const baseURL = process.env.ANDROID_BASE_URL ?? `http://${getHostLanIp()}:4173`;

export default defineConfig({
  testDir: './e2e',
  retries: 1,
  timeout: 60_000,
  projects: [
    {
      name: 'android-physical',
      use: {
        connectOptions: { wsEndpoint: `${cdpUrl}/json/version` },
        baseURL,
        // Real device camera means we cannot mock getUserMedia — tests must
        // tolerate permission prompts or pre-granted camera access.
        permissions: ['camera'],
        viewport: null, // use the device's native viewport
      },
    },
  ],
  webServer: {
    command: 'pnpm dev --host 0.0.0.0 --port 4173',
    url: `http://127.0.0.1:4173`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
