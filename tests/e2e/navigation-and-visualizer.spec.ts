import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// Never let e2e pages reach the real Suno API through the same-origin passthrough.
test.beforeEach(async ({ context }) => {
  await context.route('**/api/suno/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
});


test('persists selected tab through URL/local state reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-view-tab="albums"]').click();
  await expect(page).toHaveURL(/\?view=albums$/);

  await page.reload();
  await expect(page).toHaveURL(/\?view=albums$/);

  await page.locator('[data-view-tab="visualizer"]').click();
  await expect(page).toHaveURL(/\?view=visualizer$/);

  await page.reload();
  await expect(page).toHaveURL(/\?view=visualizer$/);

  await page.locator('[data-view-tab="cover-matrix"]').click();
  await expect(page).toHaveURL(/\?view=cover-matrix$/);
  await expect(page.getByText('Cover Slider Matrix Generator')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\?view=cover-matrix$/);
});

test('persists the library tab through reload and renders it on deep link without console errors', async ({ page }) => {
  // Ignore Suno API probe failures caused by the VITE_DISABLE_AUTH bypass session (CORS in headless dev).
  const ignored = [/studio-api\.prod\.suno\.com/, /Failed to fetch/, /net::ERR_FAILED/, /Suno connection check failed/, /Failed to get credits/, /Failed to fetch history feed/];
  const errors: string[] = [];
  const push = (text: string) => {
    if (!ignored.some((pattern) => pattern.test(text))) errors.push(text);
  };
  page.on('console', (message) => {
    if (message.type() === 'error') push(message.text());
  });
  page.on('pageerror', (error) => push(`pageerror: ${error.message}`));

  await page.goto('/');
  await page.locator('[data-view-tab="library"]').click();
  await expect(page).toHaveURL(/\?view=library$/);
  await expect(page.getByTestId('library-storage-panel')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\?view=library$/);
  await expect(page.getByTestId('library-counts')).toBeVisible();

  await page.goto('/?view=library');
  await expect(page.getByTestId('library-counts')).toBeVisible();
  expect(errors).toEqual([]);
});

test('persists pre/post roll and preview intro settings in visualizer session', async ({ page }) => {
  await page.goto('/?view=visualizer');

  await page.getByPlaceholder('Or paste Suno ID / UUID manually...').fill('draft_playwright_clip');
  await page.getByRole('button', { name: 'Load ID' }).click();
  await expect(page).toHaveURL(/clipId=draft_playwright_clip/);

  await expect(page.getByText('Style & Branding')).toBeVisible();
  await page.getByRole('button', { name: 'Timeline' }).click();

  await page.locator('[data-testid="preroll-toggle"]').click();
  await page.locator('[data-testid="preroll-text"]').fill('Playwright Pre Roll');
  await page.locator('[data-testid="preroll-seconds"]').fill('6');
  await page.locator('[data-testid="preroll-preview-toggle"]').check();
  await page.locator('[data-testid="preroll-preview-start"]').fill('12');
  await page.locator('[data-testid="preroll-preview-duration"]').fill('8');

  await page.locator('[data-testid="postroll-toggle"]').click();
  await page.locator('[data-testid="postroll-text"]').fill('Playwright Post Roll');

  await page.reload();
  await expect(page).toHaveURL(/clipId=draft_playwright_clip/);
  await expect(page.getByText('Style & Branding')).toBeVisible();
  await page.getByRole('button', { name: 'Timeline' }).click();

  await expect(page.locator('[data-testid="preroll-text"]')).toHaveValue('Playwright Pre Roll');
  await expect(page.locator('[data-testid="preroll-seconds"]')).toHaveValue('6');
  await expect(page.locator('[data-testid="preroll-preview-toggle"]')).toBeChecked();
  await expect(page.locator('[data-testid="preroll-preview-start"]')).toHaveValue('12');
  await expect(page.locator('[data-testid="preroll-preview-duration"]')).toHaveValue('8');
  await expect(page.locator('[data-testid="postroll-text"]')).toHaveValue('Playwright Post Roll');
});

test('saves default logo and keeps it available across reload', async ({ page }) => {
  const logoPath = path.join(process.cwd(), 'private', 'logo.png');
  test.skip(!fs.existsSync(logoPath), 'private/logo.png is required for this test.');

  await page.goto('/?view=visualizer');
  await page.getByPlaceholder('Or paste Suno ID / UUID manually...').fill('draft_logo_test');
  await page.getByRole('button', { name: 'Load ID' }).click();
  await expect(page.getByText('Style & Branding')).toBeVisible();
  await page.getByRole('button', { name: 'Media & Assets' }).click();

  await page.locator('input[type="file"][accept="image/png, image/jpeg, image/webp"]').setInputFiles(logoPath);
  await page.getByTestId('save-default-logo').click();

  await page.reload();
  await page.getByRole('button', { name: 'Media & Assets' }).click();
  await expect(page.getByText('logo.png')).toBeVisible();
});
