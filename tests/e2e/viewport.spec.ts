import { expect, test } from '@playwright/test';
import { resizeGameViewport } from '../helpers/resize';

test('game canvas covers the viewport and HUD overlays stay inside it', async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chromium';
  await page.setViewportSize(isMobile ? { width: 844, height: 390 } : { width: 1600, height: 800 });
  await page.goto('/');
  await page.locator('#play-button').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#hud')).toBeVisible();

  const viewport = page.viewportSize();
  const canvas = await page.locator('canvas').boundingBox();
  expect(viewport).not.toBeNull();
  expect(canvas).not.toBeNull();
  if (viewport && canvas) {
    expect(canvas.x).toBeLessThanOrEqual(0.5);
    expect(canvas.y).toBeLessThanOrEqual(0.5);
    expect(canvas.x + canvas.width).toBeGreaterThanOrEqual(viewport.width - 0.5);
    expect(canvas.y + canvas.height).toBeGreaterThanOrEqual(viewport.height - 0.5);
  }

  for (const selector of [
    '.status-card',
    '.score-card',
    '.weapon-card',
    '#kill-feed',
    '#pause-button',
  ]) {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    if (viewport && box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
  }
  await page.screenshot({
    path: `docs/screenshots/fix-fullscreen-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('portrait blocks play and rotating back leaves an active match paused', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Rotation gate applies to touch devices');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await expect(page.locator('#orientation-blocker')).toBeHidden();
  await page.locator('#play-button').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#mobile-controls')).toBeVisible();

  await resizeGameViewport(page, { width: 390, height: 844 });
  await expect(page.locator('#orientation-blocker')).toBeVisible();
  await expect(page.locator('#orientation-blocker')).toContainText('ROTATE YOUR PHONE');
  await expect(page.locator('#mobile-controls')).toBeHidden();
  await page.screenshot({
    path: `docs/screenshots/fix-portrait-blocker-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await resizeGameViewport(page, { width: 844, height: 390 });
  await expect(page.locator('#orientation-blocker')).toBeHidden();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await expect(page.locator('#mobile-controls')).toBeHidden();
  await page.locator('#pause-exit-button').click();
  await expect(page.locator('#loadout-screen')).toBeVisible();
  await expect(page).toHaveURL(/\/lobby/);
});

test('camera keeps the complete player visible at map edges and after respawn', async ({
  page,
}, testInfo) => {
  const viewports =
    testInfo.project.name === 'mobile-chromium'
      ? [
          { width: 844, height: 390 },
          { width: 932, height: 430 },
        ]
      : [
          { width: 1280, height: 720 },
          { width: 1600, height: 800 },
          { width: 1920, height: 800 },
        ];

  await page.setViewportSize(viewports[0]);
  await page.goto('/');
  await page.locator('#play-button').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#hud')).toBeVisible();

  const playerVisibility = async () =>
    page.evaluate(() => {
      const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
        player: {
          x: number;
          y: number;
          displayWidth: number;
          displayHeight: number;
          setPosition: (x: number, y: number) => void;
        };
        cameras: {
          main: {
            worldView: { left: number; right: number; top: number; bottom: number };
            zoom: number;
          };
        };
        currentMap: { worldBounds: { width: number; height: number } };
        respawnActor: (actor: unknown) => void;
      };
      const { player, cameras } = scene;
      const halfWidth = player.displayWidth / 2;
      const halfHeight = player.displayHeight / 2;
      return {
        player: { x: player.x, y: player.y },
        camera: { ...cameras.main.worldView },
        zoom: cameras.main.zoom,
        fullyVisible:
          player.x - halfWidth >= cameras.main.worldView.left - 1 &&
          player.x + halfWidth <= cameras.main.worldView.right + 1 &&
          player.y - halfHeight >= cameras.main.worldView.top - 1 &&
          player.y + halfHeight <= cameras.main.worldView.bottom + 1,
      };
    });

  for (const viewport of viewports) {
    await resizeGameViewport(page, viewport);
    await page.waitForTimeout(650);

    const canvas = await page.locator('canvas').boundingBox();
    expect(canvas?.width).toBeCloseTo(viewport.width, 0);
    expect(canvas?.height).toBeCloseTo(viewport.height, 0);

    const mapBounds = await page.evaluate(() => {
      const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
        currentMap: { worldBounds: { width: number; height: number } };
      };
      return scene.currentMap.worldBounds;
    });
    const edgePositions = [
      { x: 48, y: 100 },
      { x: mapBounds.width - 48, y: 100 },
      { x: 48, y: mapBounds.height - 100 },
      { x: mapBounds.width - 48, y: mapBounds.height - 100 },
    ];

    for (const position of edgePositions) {
      await page.evaluate(({ x, y }) => {
        const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
          player: { setPosition: (nextX: number, nextY: number) => void };
        };
        scene.player.setPosition(x, y);
      }, position);
      await page.waitForTimeout(500);
      await expect.poll(async () => (await playerVisibility()).fullyVisible).toBe(true);
    }

    await page.evaluate(() => {
      const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
        player: unknown;
        respawnActor: (actor: unknown) => void;
      };
      scene.respawnActor(scene.player);
    });
    await page.waitForTimeout(50);
    expect((await playerVisibility()).fullyVisible).toBe(true);
  }
});
