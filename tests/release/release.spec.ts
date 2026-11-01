import { expect, test } from '@playwright/test';

const allMaps = [
  'outpost-kilo',
  'drydock-12',
  'ember-foundry',
  'canopy-ruins',
  'frost-relay',
  'neon-underpass',
  'sky-fortress',
  'blacksite-zero',
];

test('production artifact loads, completes a match, saves, and reloads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/?e2e-fast');
  await expect(page.locator('body')).not.toContainText(/multiplayer/i);
  await page.locator('#play-button').click();
  await expect(page.locator('[data-mode-id]')).toHaveCount(6);
  for (const mapId of allMaps.slice(0, 4)) {
    await expect(page.locator(`[data-map-id="${mapId}"]`)).toBeEnabled();
  }
  for (const mapId of allMaps.slice(4)) {
    await expect(page.locator(`[data-map-id="${mapId}"]`)).toBeDisabled();
  }
  await page.locator('#deploy-button').click();
  await expect(page.locator('#result-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#result-stats')).toContainText('eliminations');

  await page.reload();
  await expect(page.locator('#loadout-screen')).toBeVisible();
  await expect(page.locator('#profile-summary')).toContainText(/[1-9]\d* XP/);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('flashfire.save')!).profile.totalMatches,
    ),
  ).toBe(1);
  expect(errors).toEqual([]);
});

test('rank unlock rules expose every map in the production artifact', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((maps) => {
    const raw = localStorage.getItem('flashfire.save');
    if (!raw) throw new Error('Default save was not created.');
    const save = JSON.parse(raw) as { profile: { rank: number }; unlocks: { maps: string[] } };
    save.profile.rank = 30;
    save.unlocks.maps = maps;
    localStorage.setItem('flashfire.save', JSON.stringify(save));
  }, allMaps);
  await page.reload();
  await page.locator('#play-button').click();
  await expect(page.locator('[data-map-id]')).toHaveCount(8);
  for (const mapId of allMaps) {
    await expect(page.locator(`[data-map-id="${mapId}"]`)).toBeEnabled();
  }
});
