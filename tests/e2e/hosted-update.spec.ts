import { expect, test } from '@playwright/test';

test('actual combat applies beginner damage reduction without reducing player damage', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
  for (const [difficulty, expected] of [
    ['recruit', 11],
    ['regular', 15],
    ['veteran', 20],
  ] as const) {
    await page.goto('/');
    await page.locator('#play-button').click();
    await page.locator('#settings-button').click();
    await page.locator(`[data-difficulty-id="${difficulty}"]`).click();
    await page.locator('#settings-modal .modal-close').click();
    await page.locator('#deploy-button').click();
    await expect(page.locator('#hud')).toBeVisible();
    const damage = await page.evaluate(() => {
      const scene = window.__flashfireGame!.scene.getScene('arena') as any;
      scene.togglePause();
      const player = scene.player,
        bot = scene.bots[0];
      player.health = bot.health = 100;
      player.armor = bot.armor = 0;
      scene.damageActor(player, 20, bot);
      scene.damageActor(bot, 20, player);
      return { received: 100 - player.health, dealt: 100 - bot.health };
    });
    expect(damage).toEqual({ received: expected, dealt: 20 });
  }
});

test('supply cooldown blocks weapon drops, then re-arms after a real weapon drop', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
  await page.goto('/');
  await page.locator('#play-button').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#hud')).toBeVisible();
  const result = await page.evaluate(() => {
    const scene = window.__flashfireGame!.scene.getScene('arena') as any;
    scene.togglePause();
    const initialDelay = scene.nextWeaponDropAt - scene.time.now;
    const early = Array.from({ length: 12 }, () => scene.spawnSupplyDrop().getData('type'));
    scene.nextWeaponDropAt = scene.time.now;
    let received = false;
    for (let i = 0; i < 40 && !received; i++)
      received = scene.spawnSupplyDrop().getData('type') === 'weapon';
    const cooldown = scene.nextWeaponDropAt - scene.time.now;
    const later = Array.from({ length: 12 }, () => scene.spawnSupplyDrop().getData('type'));
    return {
      initialDelay,
      early,
      received,
      cooldown,
      later,
      scoreLimit: scene.currentMode.scoreLimit,
    };
  });
  expect(result.initialDelay).toBeGreaterThanOrEqual(18_000);
  expect(result.initialDelay).toBeLessThanOrEqual(24_000);
  expect(result.early).not.toContain('weapon');
  expect(result.received).toBe(true);
  expect(result.cooldown).toBeGreaterThanOrEqual(18_000);
  expect(result.cooldown).toBeLessThanOrEqual(24_000);
  expect(result.later).not.toContain('weapon');
  expect(result.scoreLimit).toBe(20);
});

test('required desktop sizes preserve bounded backing and inverse pointer coordinates', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
  test.setTimeout(90_000);
  await page.goto('/');
  await page.locator('#play-button').click();
  await page.locator('#mode-selector-button').click();
  await page.locator('[data-mode-id="training-range"]').click();
  await page.locator('#deploy-button').click();
  await page.evaluate(() => {
    const scene = window.__flashfireGame!.scene.getScene('arena');
    scene.physics.pause();
    scene.cameras.main.stopFollow();
  });
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1080],
    [2560, 1440],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('canvas')).toHaveCSS('width', `${width}px`);
    await page.mouse.move(Math.round(width * 0.62), Math.round(height * 0.43));
    await page.waitForTimeout(100);
    const mapping = await page.evaluate(() => {
      const game = window.__flashfireGame!,
        scene = game.scene.getScene('arena');
      const canvas = game.canvas,
        box = canvas.getBoundingClientRect(),
        pointer = scene.input.activePointer;
      const expected = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      return {
        pixels: canvas.width * canvas.height,
        aspect: canvas.width / canvas.height,
        x: pointer.x,
        y: pointer.y,
        expectedX: (Math.round(innerWidth * 0.62) * canvas.width) / box.width,
        expectedY: (Math.round(innerHeight * 0.43) * canvas.height) / box.height,
        worldX: pointer.worldX,
        worldY: pointer.worldY,
        inverseX: expected.x,
        inverseY: expected.y,
      };
    });
    expect(mapping.pixels).toBeLessThanOrEqual(3_600_000);
    expect(mapping.aspect).toBeCloseTo(width / height, 6);
    expect(mapping.x).toBeCloseTo(mapping.expectedX, 1);
    expect(mapping.y).toBeCloseTo(mapping.expectedY, 1);
    expect(mapping.worldX).toBeCloseTo(mapping.inverseX, 1);
    expect(mapping.worldY).toBeCloseTo(mapping.inverseY, 1);
  }
});
