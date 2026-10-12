import { expect, test, type Page } from '@playwright/test';

// Never let e2e pages reach the real Suno API through the same-origin passthrough.
test.beforeEach(async ({ context }) => {
  await context.route('**/api/suno/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
});


/**
 * Library management e2e (roadmap tasks 4, 6, 8, 9, 15).
 *
 * Tracks are seeded straight into IndexedDB through the Vite dev server by dynamically
 * importing /src/services/offlineDb.ts in page context (no network sync). Each Playwright
 * test gets a fresh browser context, so IndexedDB and the Cache API start empty.
 */

const ASSET_CACHE = 'suno-architect-assets-v1';
const OFFLINE_DB_MODULE = '/src/services/offlineDb.ts';

interface SeedTrack {
  id: string;
  title: string;
  tags: string[];
  durationMs?: number;
  archivedAt?: number;
  goneFromRemote?: boolean;
  variants?: number;
  updatedAt?: number;
}

const audioUrlFor = (id: string) => `https://cdn1.suno.ai/${id}.mp3`;

const seedTracks = async (page: Page, seeds: SeedTrack[]) => {
  await page.evaluate(
    async ({ seeds, modulePath }) => {
      const db = await import(modulePath);
      const now = Date.now();
      const tracks = seeds.map((seed, index) => ({
        id: seed.id,
        sunoId: seed.id,
        title: seed.title,
        audioUrl: `https://cdn1.suno.ai/${seed.id}.mp3`,
        imageUrl: '',
        lyricsText: '',
        lrcContent: '',
        srtContent: '',
        metadata: { tags: seed.tags, prompt: '', durationMs: seed.durationMs ?? 0 },
        cachedLocally: false,
        raw: {},
        createdAt: now - index * 1000,
        updatedAt: seed.updatedAt ?? now - index * 1000,
        variants: Array.from({ length: seed.variants ?? 0 }, (_, i) => ({
          id: `${seed.id}-variant-${i}`,
          type: 'mastered',
          title: `Master ${i + 1}`,
          audioUrl: `https://cdn1.suno.ai/${seed.id}-variant-${i}.mp3`,
          createdAt: now - i,
        })),
        ...(seed.archivedAt ? { archivedAt: seed.archivedAt } : {}),
        ...(seed.goneFromRemote ? { goneFromRemote: true } : {}),
      }));
      await db.upsertTracks(tracks);
    },
    { seeds, modulePath: OFFLINE_DB_MODULE }
  );
};

const readTrackIds = async (page: Page): Promise<Record<string, { archived: boolean; gone: boolean }>> =>
  page.evaluate(async (modulePath) => {
    const db = await import(modulePath);
    const all = await db.listAllTracks();
    const out: Record<string, { archived: boolean; gone: boolean }> = {};
    for (const track of all) {
      out[track.id] = { archived: typeof track.archivedAt === 'number', gone: track.goneFromRemote === true };
    }
    return out;
  }, OFFLINE_DB_MODULE);

const seedCacheEntries = async (page: Page, urls: string[]) => {
  await page.evaluate(
    async ({ urls, cacheName }) => {
      const cache = await caches.open(cacheName);
      for (const url of urls) {
        await cache.put(url, new Response('seeded-audio', { headers: { 'Content-Type': 'audio/mpeg' } }));
      }
    },
    { urls, cacheName: ASSET_CACHE }
  );
};

const readCacheKeys = async (page: Page): Promise<string[]> =>
  page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map((request) => request.url);
  }, ASSET_CACHE);

/**
 * Console errors that are environment noise rather than library regressions: the dev server runs with
 * VITE_DISABLE_AUTH=true, which makes App.tsx probe the Suno API with the bypass session on every load,
 * and those requests fail with CORS/network errors in a headless browser without a proxy.
 */
const IGNORED_CONSOLE_PATTERNS = [
  /studio-api\.prod\.suno\.com/,
  /Failed to fetch/,
  /net::ERR_FAILED/,
  /Suno connection check failed/,
  /Failed to get credits/,
  /Failed to fetch history feed/,
];

const collectConsoleErrors = (page: Page) => {
  const errors: string[] = [];
  const push = (text: string) => {
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  };
  page.on('console', (message) => {
    if (message.type() === 'error') push(message.text());
  });
  page.on('pageerror', (error) => push(`pageerror: ${error.message}`));
  return errors;
};

const libraryCards = (page: Page) => page.locator('[data-track-id]');
const card = (page: Page, id: string) => page.locator(`[data-track-id="${id}"]`);

const openLibraryView = async (page: Page) => {
  await page.goto('/?view=library');
  await expect(page.getByTestId('library-counts')).toBeVisible();
};

test.describe('Library view', () => {
  test('deep link /?view=library renders with no console errors and an empty guidance state', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openLibraryView(page);

    await expect(page.getByTestId('library-counts')).toHaveText('0 active · 0 archived · 0 no longer on Suno');
    await expect(page.getByTestId('library-storage-panel')).toBeVisible();
    await expect(page.getByTestId('library-empty-state')).toContainText('No tracks in library yet.');
    await expect(page.getByTestId('library-empty-state')).toContainText('Sync Local Library Cache');
    expect(errors).toEqual([]);
  });

  test('shows per-tab empty states with guidance when zero tracks are seeded', async ({ page }) => {
    await openLibraryView(page);

    await page.locator('[data-library-filter="active"]').click();
    await expect(page.getByTestId('library-empty-state')).toContainText('No active tracks.');

    await page.locator('[data-library-filter="archived"]').click();
    await expect(page.getByTestId('library-empty-state')).toContainText('Nothing archived.');

    await page.locator('[data-library-filter="gone"]').click();
    await expect(page.getByTestId('library-empty-state')).toContainText('Every track is still on Suno.');

    await page.locator('[data-library-filter="all"]').click();
    await expect(page.getByTestId('library-empty-state')).toContainText('No tracks in library yet.');
  });

  test('reports counts per status and filters cards by status tab', async ({ page }) => {
    await page.goto('/');
    await seedTracks(page, [
      { id: 'lib-alpha', title: 'Alpha Anthem', tags: ['synthwave', 'retro'], durationMs: 185000, variants: 2 },
      { id: 'lib-beta', title: 'Beta Ballad', tags: ['ballad'], durationMs: 65000 },
      { id: 'lib-gamma', title: 'Gamma Groove', tags: ['funk'], goneFromRemote: true },
      { id: 'lib-delta', title: 'Delta Dirge', tags: ['doom'], archivedAt: Date.now() - 1000 },
    ]);
    await openLibraryView(page);

    await expect(page.getByTestId('library-counts')).toHaveText('3 active · 1 archived · 1 no longer on Suno');
    await expect(libraryCards(page)).toHaveCount(4);

    await expect(card(page, 'lib-alpha')).toContainText('3:05');
    await expect(card(page, 'lib-alpha')).toContainText('2 variants');
    await expect(card(page, 'lib-alpha')).toContainText('synthwave');
    await expect(card(page, 'lib-delta').locator('[data-track-chip="archived"]')).toBeVisible();
    await expect(card(page, 'lib-gamma').locator('[data-track-chip="gone"]')).toHaveText('No longer on Suno');
    await expect(card(page, 'lib-alpha').locator('[data-track-chip]')).toHaveCount(0);

    await page.locator('[data-library-filter="active"]').click();
    await expect(libraryCards(page)).toHaveCount(3);
    await expect(card(page, 'lib-delta')).toHaveCount(0);

    await page.locator('[data-library-filter="archived"]').click();
    await expect(libraryCards(page)).toHaveCount(1);
    await expect(card(page, 'lib-delta')).toBeVisible();

    await page.locator('[data-library-filter="gone"]').click();
    await expect(libraryCards(page)).toHaveCount(1);
    await expect(card(page, 'lib-gamma')).toBeVisible();

    await page.locator('[data-library-filter="all"]').click();
    await expect(libraryCards(page)).toHaveCount(4);
  });

  test('search narrows by title or tag and the tag dropdown filters exactly', async ({ page }) => {
    await page.goto('/');
    await seedTracks(page, [
      { id: 'lib-alpha', title: 'Alpha Anthem', tags: ['synthwave', 'retro'] },
      { id: 'lib-beta', title: 'Beta Ballad', tags: ['ballad'] },
      { id: 'lib-gamma', title: 'Gamma Groove', tags: ['funk', 'retro'] },
    ]);
    await openLibraryView(page);
    await expect(libraryCards(page)).toHaveCount(3);

    const search = page.getByLabel('Search library');
    await search.fill('alpha');
    await expect(libraryCards(page)).toHaveCount(1);
    await expect(card(page, 'lib-alpha')).toBeVisible();

    await search.fill('retro');
    await expect(libraryCards(page)).toHaveCount(2);

    await search.fill('nothing-matches-this');
    await expect(page.getByTestId('library-empty-state')).toContainText('No tracks match your filters.');

    await search.fill('');
    await page.getByLabel('Filter by tag').selectOption('ballad');
    await expect(libraryCards(page)).toHaveCount(1);
    await expect(card(page, 'lib-beta')).toBeVisible();

    await page.getByLabel('Filter by tag').selectOption('');
    await expect(libraryCards(page)).toHaveCount(3);
  });

  test('archive moves a card Active -> Archived, evicts its cached audio, survives reload, and Restore moves it back', async ({ page }) => {
    await page.goto('/');
    await seedTracks(page, [
      { id: 'lib-alpha', title: 'Alpha Anthem', tags: ['synthwave'] },
      { id: 'lib-beta', title: 'Beta Ballad', tags: ['ballad'] },
    ]);
    await seedCacheEntries(page, [audioUrlFor('lib-alpha'), audioUrlFor('lib-beta')]);
    expect(await readCacheKeys(page)).toEqual(expect.arrayContaining([audioUrlFor('lib-alpha'), audioUrlFor('lib-beta')]));

    await openLibraryView(page);
    await expect(page.getByTestId('library-cached-assets')).toHaveText('2');

    await page.locator('[data-library-filter="active"]').click();
    await expect(libraryCards(page)).toHaveCount(2);
    await card(page, 'lib-alpha').locator('[data-track-action="archive"]').click();

    await expect(card(page, 'lib-alpha')).toHaveCount(0);
    await expect(libraryCards(page)).toHaveCount(1);
    await expect(page.getByTestId('library-counts')).toHaveText('1 active · 1 archived · 0 no longer on Suno');

    await expect.poll(() => readCacheKeys(page)).not.toContain(audioUrlFor('lib-alpha'));
    expect(await readCacheKeys(page)).toContain(audioUrlFor('lib-beta'));
    await expect(page.getByTestId('library-cached-assets')).toHaveText('1');

    await page.locator('[data-library-filter="archived"]').click();
    await expect(card(page, 'lib-alpha')).toBeVisible();
    await expect(card(page, 'lib-alpha')).toHaveAttribute('data-track-status', 'archived');
    await expect(card(page, 'lib-alpha').locator('[data-track-chip="archived"]')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('library-counts')).toHaveText('1 active · 1 archived · 0 no longer on Suno');
    await page.locator('[data-library-filter="archived"]').click();
    await expect(card(page, 'lib-alpha')).toBeVisible();

    await card(page, 'lib-alpha').locator('[data-track-action="restore"]').click();
    await expect(page.getByTestId('library-counts')).toHaveText('2 active · 0 archived · 0 no longer on Suno');
    await expect(page.getByTestId('library-empty-state')).toContainText('Nothing archived.');

    await page.locator('[data-library-filter="active"]').click();
    await expect(card(page, 'lib-alpha')).toHaveAttribute('data-track-status', 'active');
    expect(await readTrackIds(page)).toEqual({
      'lib-alpha': { archived: false, gone: false },
      'lib-beta': { archived: false, gone: false },
    });
  });

  test('two rapid Archive clicks leave a consistent single archived row after reload', async ({ page }) => {
    await page.goto('/');
    await seedTracks(page, [{ id: 'lib-race', title: 'Race Condition', tags: ['test'] }]);
    await openLibraryView(page);

    // Two clicks dispatched in the same JS task: the second fires before React can disable the button.
    await card(page, 'lib-race')
      .locator('[data-track-action="archive"]')
      .evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });

    await expect(card(page, 'lib-race')).toHaveAttribute('data-track-status', 'archived');
    await page.reload();
    await expect(page.getByTestId('library-counts')).toHaveText('0 active · 1 archived · 0 no longer on Suno');
    await expect(libraryCards(page)).toHaveCount(1);
    expect(await readTrackIds(page)).toEqual({ 'lib-race': { archived: true, gone: false } });
  });

  test('storage panel renders numbers normally and "unavailable" when storage.estimate is missing', async ({ page }) => {
    await openLibraryView(page);
    const usage = page.getByTestId('library-storage-usage');
    await expect(usage).not.toHaveText('…');
    await expect(usage).toHaveText(/^(\d+(\.\d+)? (B|KB|MB|GB|TB)|unavailable)$/);
    await expect(page.getByTestId('library-cached-assets')).toHaveText(/^\d+$/);

    const stubbed = await page.context().newPage();
    const errors = collectConsoleErrors(stubbed);
    await stubbed.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    });
    await stubbed.goto('/?view=library');
    await expect(stubbed.getByTestId('library-storage-usage')).toHaveText('unavailable');
    await expect(stubbed.getByTestId('library-storage-panel')).toContainText('unavailable of unavailable');
    expect(errors).toEqual([]);
    await stubbed.close();
  });
});

test.describe('Library picker modal', () => {
  const openPicker = async (page: Page) => {
    await page.goto('/?view=web-audio-master');
    await page.getByRole('button', { name: 'Select from Library' }).click();
    await expect(page.getByRole('heading', { name: 'Select from Library' })).toBeVisible();
  };

  test('shows active rows as selectable, archived rows dimmed with Restore, and a gone chip', async ({ page }) => {
    await page.goto('/');
    await seedTracks(page, [
      { id: 'pick-active', title: 'Pickable Track', tags: ['pop'], durationMs: 125000, variants: 1 },
      { id: 'pick-gone', title: 'Vanished Track', tags: ['pop'], goneFromRemote: true },
      { id: 'pick-archived', title: 'Shelved Track', tags: ['pop'], archivedAt: Date.now() - 500 },
    ]);
    await openPicker(page);

    await expect(card(page, 'pick-active').locator('[data-track-action="select"]')).toBeEnabled();
    await expect(card(page, 'pick-active')).toContainText('2:05');
    await expect(card(page, 'pick-active').locator('[data-track-chip]')).toHaveCount(0);

    await expect(card(page, 'pick-gone').locator('[data-track-chip="gone"]')).toHaveText('No longer on Suno');
    await expect(card(page, 'pick-gone').locator('[data-track-action="select"]')).toBeEnabled();

    const archivedRow = card(page, 'pick-archived');
    await expect(archivedRow).toHaveAttribute('data-track-status', 'archived');
    await expect(archivedRow.locator('[data-track-chip="archived"]')).toBeVisible();
    await expect(archivedRow.locator('[data-track-action="select"]')).toBeDisabled();
    await expect(archivedRow.locator('[data-track-action="restore"]')).toBeVisible();
    await expect(archivedRow.getByLabel('Track actions')).toHaveCount(0);

    await archivedRow.locator('[data-track-action="restore"]').click();
    await expect(card(page, 'pick-archived')).toHaveAttribute('data-track-status', 'active');
    await expect(card(page, 'pick-archived').locator('[data-track-action="select"]')).toBeEnabled();
  });

  test('archive via the row menu evicts cached audio, persists across reload, and Restore re-enables select', async ({ page }) => {
    await page.goto('/');
    await seedTracks(page, [
      { id: 'pick-one', title: 'First Pick', tags: ['a'] },
      { id: 'pick-two', title: 'Second Pick', tags: ['b'] },
    ]);
    await seedCacheEntries(page, [audioUrlFor('pick-one'), audioUrlFor('pick-two')]);
    await openPicker(page);
    await expect(page.locator('[data-track-id]')).toHaveCount(2);

    const row = card(page, 'pick-one');
    await expect(row.locator('[data-track-action="archive"]')).toHaveCount(0);
    await row.getByLabel('Track actions').click();
    await row.locator('[data-track-action="archive"]').click();

    // The archive handler lazy-imports the sync service; under a parallel run Vite may still be transforming it.
    await expect(row).toHaveAttribute('data-track-status', 'archived', { timeout: 15_000 });
    await expect(row.locator('[data-track-chip="archived"]')).toBeVisible();
    await expect(row.locator('[data-track-action="select"]')).toBeDisabled();
    await expect.poll(() => readCacheKeys(page)).not.toContain(audioUrlFor('pick-one'));
    expect(await readCacheKeys(page)).toContain(audioUrlFor('pick-two'));

    await page.reload();
    await page.getByRole('button', { name: 'Select from Library' }).click();
    await expect(card(page, 'pick-one')).toHaveAttribute('data-track-status', 'archived');
    await expect(card(page, 'pick-one').locator('[data-track-action="select"]')).toBeDisabled();
    // Active tracks list first; the archived one trails the list.
    await expect(page.locator('[data-track-id]').first()).toHaveAttribute('data-track-id', 'pick-two');

    await card(page, 'pick-one').locator('[data-track-action="restore"]').click();
    await expect(card(page, 'pick-one')).toHaveAttribute('data-track-status', 'active');
    await expect(card(page, 'pick-one').locator('[data-track-action="select"]')).toBeEnabled();
  });

  test('shows the "No tracks in library" empty state when nothing is stored', async ({ page }) => {
    await openPicker(page);
    await expect(page.getByText('No tracks in library')).toBeVisible();
    await expect(page.getByText('Sync your library from Suno to see tracks here')).toBeVisible();
    await expect(page.locator('[data-track-id]')).toHaveCount(0);
  });
});

test.describe('Visualizer publishing workflow', () => {
  test('Export tab labels publishing as a dry-run and never calls the publish API without a click', async ({ page }) => {
    let publishCalls = 0;
    await page.route('**/api/publish/**', (route) => {
      publishCalls += 1;
      route.fulfill({ status: 500, body: 'should not be called' });
    });

    await page.goto('/?view=visualizer');
    await page.getByPlaceholder('Or paste Suno ID / UUID manually...').fill('draft_dry_run_clip');
    await page.getByRole('button', { name: 'Load ID' }).click();
    await expect(page).toHaveURL(/clipId=draft_dry_run_clip/);
    await expect(page.getByText('Style & Branding')).toBeVisible();

    await page.getByRole('button', { name: 'Export' }).click();
    const details = page.locator('details').filter({ hasText: 'Publishing Workflow' });
    await expect(details).toBeVisible();
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await details.locator('summary').click();
    }

    await expect(page.getByTestId('publish-dry-run-banner')).toHaveText(
      'Dry-run preview — no upload happens yet (YouTube/Facebook publishing is not connected).'
    );
    await expect(page.getByRole('button', { name: 'Run Dry-Run Publish Preview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Publish Workflow' })).toHaveCount(0);
    expect(publishCalls).toBe(0);
  });
});
