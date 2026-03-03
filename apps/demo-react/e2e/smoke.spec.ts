import { expect, test } from '@playwright/test';

test('demo shell loads', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173');
  await expect(page.getByText('document-autocapture')).toBeVisible();
});
