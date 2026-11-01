import { expect, test } from '@playwright/test';

test('arrow controls move in every direction while standard letters remain active', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#play-button').click();
  await page.locator('#mode-selector-button').click();
  await page.locator('[data-mode-id="training-range"]').click();
  await page.locator('#settings-button').click();
  await page.locator('[data-settings-tab="access"]').click();
  await page.locator('[data-binding="left"]').selectOption('ARROWLEFT');
  await page.locator('[data-binding="jet"]').selectOption('ARROWUP');
  await page.locator('[data-binding="down"]').selectOption('ARROWDOWN');
  await page.locator('#settings-modal .modal-close').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#hud')).toBeVisible();

  const position = async () =>
    page.evaluate(() => {
      const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
        player: {
          x: number;
          y: number;
          setPosition: (x: number, y: number) => void;
          setVelocity: (x: number, y: number) => void;
          setAcceleration: (x: number, y: number) => void;
        };
      };
      return { x: scene.player.x, y: scene.player.y };
    });
  const reset = async () =>
    page.evaluate(() => {
      const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
        player: {
          setPosition: (x: number, y: number) => void;
          setVelocity: (x: number, y: number) => void;
          setAcceleration: (x: number, y: number) => void;
          fuel: number;
        };
      };
      scene.player.setPosition(640, 180);
      scene.player.setVelocity(0, 0);
      scene.player.setAcceleration(0, 0);
      scene.player.fuel = 100;
    });

  await reset();
  const beforeLeft = await position();
  await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => (await position()).x).toBeLessThan(beforeLeft.x);
  await page.keyboard.up('ArrowLeft');
  expect((await position()).x).toBeLessThan(beforeLeft.x);

  await reset();
  const beforeLetter = await position();
  await page.keyboard.down('a');
  await expect.poll(async () => (await position()).x).toBeLessThan(beforeLetter.x);
  await page.keyboard.up('a');
  expect((await position()).x).toBeLessThan(beforeLetter.x);

  await reset();
  const beforeUp = await position();
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await position()).y).toBeLessThan(beforeUp.y);
  await page.keyboard.up('ArrowUp');
  expect((await position()).y).toBeLessThan(beforeUp.y);

  await reset();
  const beforeDown = await position();
  await page.keyboard.down('ArrowDown');
  await expect.poll(async () => (await position()).y).toBeGreaterThan(beforeDown.y);
  await page.keyboard.up('ArrowDown');
  expect((await position()).y).toBeGreaterThan(beforeDown.y);
});

test('damaging map hazards affect the player but never bots or the player score', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const raw = localStorage.getItem('flashfire.save');
    if (!raw) throw new Error('Expected a save document');
    const save = JSON.parse(raw) as { profile: { rank: number }; unlocks: { maps: string[] } };
    save.profile.rank = 30;
    if (!save.unlocks.maps.includes('neon-underpass')) save.unlocks.maps.push('neon-underpass');
    localStorage.setItem('flashfire.save', JSON.stringify(save));
  });
  await page.locator('#play-button').click();
  await page.locator('#arena-selector-button').click();
  await page.locator('[data-map-id="neon-underpass"]').click();
  await page.locator('#mode-selector-button').click();
  await page.locator('[data-mode-id="training-range"]').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#hud')).toBeVisible();

  const result = await page.evaluate(async () => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
      player: { alive: boolean; health: number };
      bots: Array<{ alive: boolean; health: number }>;
      hazards: { getChildren: () => Array<{ getData: (key: string) => unknown }> };
      modeRuntime: { rangerScore: number };
      applyHazard: (actor: unknown, hazard: unknown) => void;
    };
    const train = scene.hazards
      .getChildren()
      .find((item) => item.getData('hazardType') === 'train');
    if (!train) throw new Error('Neon Underpass train hazard is missing');
    const bot = scene.bots[0];
    const botHealth = bot.health;
    scene.applyHazard(bot, train);
    const botResult = {
      alive: bot.alive,
      health: bot.health,
      score: scene.modeRuntime.rangerScore,
    };
    scene.applyHazard(scene.player, train);
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!scene.player.alive) resolve();
        else window.requestAnimationFrame(check);
      };
      check();
    });
    return {
      bot: botResult,
      originalBotHealth: botHealth,
      playerAlive: scene.player.alive,
      score: scene.modeRuntime.rangerScore,
    };
  });

  expect(result.bot).toEqual({ alive: true, health: result.originalBotHealth, score: 0 });
  expect(result.playerAlive).toBe(false);
  expect(result.score).toBe(0);
});
