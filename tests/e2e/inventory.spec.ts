import { expect, test } from '@playwright/test';

test('match inventory starts with M9 and enforces two recoverable weapon slots', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.locator('#play-button').click();
  await page.locator('#mode-selector-button').click();
  await page.locator('[data-mode-id="training-range"]').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#weapon-slots')).toBeVisible();
  await expect(page.locator('[data-weapon-slot="0"]')).toContainText('M9 PISTOL');
  await expect(page.locator('[data-weapon-slot="1"]')).toBeDisabled();

  const dropOnPlayer = async (weaponId: 'ak47' | 'hydra', xOffset = 0) => {
    await page.evaluate(
      ({ nextWeaponId, offset }) => {
        const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
          player: { x: number; y: number };
          addPickup: (
            x: number,
            y: number,
            texture: string,
            type: string,
            weaponId: string,
            lifetime: number,
          ) => void;
        };
        scene.addPickup(
          scene.player.x + offset,
          scene.player.y,
          'weapon-crate',
          'weapon',
          nextWeaponId,
          18_000,
        );
      },
      { nextWeaponId: weaponId, offset: xOffset },
    );
  };

  await dropOnPlayer('ak47');
  await expect(page.locator('[data-weapon-slot="1"]')).toContainText('AK-47');
  await expect(page.locator('[data-weapon-slot="1"]')).toHaveClass(/active/);

  await dropOnPlayer('hydra', 58);
  await expect(page.locator('#pickup-prompt')).toBeVisible();
  await expect(page.locator('#pickup-prompt')).toContainText('HYDRA LAUNCHER');
  await expect(page.locator('[data-weapon-slot="1"]')).toContainText('AK-47');
  const visibleDrop = await page.evaluate(() => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
      pickups: {
        getChildren: () => Array<{
          texture: { key: string };
          label?: { text: string };
          getData: (key: string) => unknown;
        }>;
      };
    };
    const hydra = scene.pickups.getChildren().find((item) => item.getData('value') === 'hydra');
    return hydra ? { texture: hydra.texture.key, label: hydra.label?.text } : null;
  });
  expect(visibleDrop).toEqual({ texture: 'hydra', label: 'HYDRA LAUNCHER' });
  await page.screenshot({
    path: `docs/screenshots/fix-manual-weapon-pickup-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.locator('#pickup-prompt').click();
  await expect(page.locator('[data-weapon-slot="0"]')).toContainText('M9 PISTOL');
  await expect(page.locator('[data-weapon-slot="1"]')).toContainText('HYDRA');
  await expect(page.locator('[data-weapon-slot="1"]')).toHaveClass(/active/);

  const discardedGun = await page.evaluate(() => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
      supplyDropTimer?: unknown;
      pickups: {
        getChildren: () => Array<{
          active: boolean;
          getData: (key: string) => unknown;
        }>;
      };
    };
    const discarded = scene.pickups
      .getChildren()
      .find((item) => item.active && item.getData('value') === 'ak47');
    return { found: Boolean(discarded), timerScheduled: Boolean(scene.supplyDropTimer) };
  });
  expect(discardedGun).toEqual({ found: true, timerScheduled: true });

  await page.locator('[data-weapon-slot="0"]').click();
  await expect(page.locator('#weapon-name')).toHaveText('M9 PISTOL');
  await expect(page.locator('[data-weapon-slot="0"]')).toHaveClass(/active/);

  const recoveredByBot = await page.evaluate(() => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
      player: { id: string };
      bots: Array<{ x: number; y: number; alive: boolean; weaponSlots: string[] }>;
      addPickup: (
        x: number,
        y: number,
        texture: string,
        type: string,
        weaponId: string,
        lifetime: number,
        blockedActorId: string,
      ) => unknown;
      collectPickup: (actor: unknown, item: unknown) => void;
    };
    const bot = scene.bots.find((candidate) => candidate.alive) ?? scene.bots[0];
    const discarded = scene.addPickup(
      bot.x,
      bot.y,
      'weapon-crate',
      'weapon',
      'viper',
      20_000,
      scene.player.id,
    );
    scene.collectPickup(bot, discarded);
    return bot.weaponSlots.includes('viper');
  });
  expect(recoveredByBot).toBe(true);

  const temporaryPickupId = await page.evaluate(() => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
      player: { x: number; y: number };
      addPickup: (
        x: number,
        y: number,
        texture: string,
        type: string,
        value: undefined,
        lifetime: number,
      ) => { pickupId: string };
    };
    return scene.addPickup(scene.player.x + 300, scene.player.y, 'medkit', 'health', undefined, 100)
      .pickupId;
  });
  await page.waitForFunction((pickupId) => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as any;
    return !scene.pickups.getChildren().some((item: any) => item.pickupId === pickupId);
  }, temporaryPickupId);
  const temporaryPickupExists = await page.evaluate((pickupId) => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
      pickups: { getChildren: () => Array<{ pickupId: string }> };
    };
    return scene.pickups.getChildren().some((item) => item.pickupId === pickupId);
  }, temporaryPickupId);
  expect(temporaryPickupExists).toBe(false);

  await page.screenshot({
    path: `docs/screenshots/fix-two-slot-inventory-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
