import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

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
});

test('persists pre/post roll and preview intro settings in visualizer session', async ({ page }) => {
  await page.goto('/?view=visualizer');

  await page.getByPlaceholder('Or paste Suno ID / UUID manually...').fill('draft_playwright_clip');
  await page.getByRole('button', { name: 'Load ID' }).click();
  await expect(page).toHaveURL(/clipId=draft_playwright_clip/);

  await expect(page.getByText('Visual & Export Settings')).toBeVisible();

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
  await expect(page.getByText('Visual & Export Settings')).toBeVisible();

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
  await expect(page.getByText('Visual & Export Settings')).toBeVisible();

  await page.locator('input[type="file"][accept="image/png, image/jpeg, image/webp"]').setInputFiles(logoPath);
  await page.getByTestId('save-default-logo').click();

  await page.reload();
  await expect(page.getByText('logo.png')).toBeVisible();
});
