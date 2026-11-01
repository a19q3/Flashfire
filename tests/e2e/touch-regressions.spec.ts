import { expect, test, type Page } from '@playwright/test';
import { resizeGameViewport } from '../helpers/resize';

interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

async function touchState(page: Page) {
  return page.evaluate(() => {
    const scene = window.__flashfireGame?.scene.getScene('arena') as unknown as {
      touch: {
        snapshot: () => { moveX: number; wantsJet: boolean; wantsDrop: boolean; firing: boolean };
      };
      keys: { right: { isDown: boolean } };
    };
    return { ...scene.touch.snapshot(), rightHeld: scene.keys.right.isDown };
  });
}

async function point(page: Page, selector: string, id: number, dx: number): Promise<TouchPoint> {
  const bounds = await page.locator(selector).boundingBox();
  if (!bounds) throw new Error(`Missing touch pad: ${selector}`);
  return { id, x: bounds.x + bounds.width / 2 + dx, y: bounds.y + bounds.height / 2 };
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Uses real Chromium touch input');
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await page.locator('#play-button').click();
  await page.locator('#mode-selector-button').click();
  await page.locator('[data-mode-id="training-range"]').click();
  await page.locator('#deploy-button').click();
  await expect(page.locator('#hud')).toBeVisible();
});

test('movement touch does not fire, while the separate aim stick does', async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  const move = await point(page, '#move-pad', 1, 25);
  const aim = await point(page, '#aim-pad', 2, 25);
  const ammo = await page.locator('#ammo-value').innerText();
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move] });
  await expect.poll(async () => (await touchState(page)).moveX).toBeGreaterThan(0.2);
  await page.waitForTimeout(450);
  await expect(page.locator('#ammo-value')).toHaveText(ammo);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move, aim] });
  await expect.poll(async () => (await touchState(page)).firing).toBe(true);
  await expect(page.locator('#ammo-value')).not.toHaveText(ammo);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});

test('unrelated fingers cannot steal a stick and losing capture clears its input', async ({
  page,
}) => {
  await page.locator('#move-pad').evaluate((element) => {
    element.addEventListener('pointerdown', (event) => {
      (element as HTMLElement).dataset.pointer = String((event as PointerEvent).pointerId);
    });
  });
  await page.locator('#aim-pad').evaluate((element) => {
    element.addEventListener('pointerdown', (event) => {
      (element as HTMLElement).dataset.pointer = String((event as PointerEvent).pointerId);
    });
  });
  const client = await page.context().newCDPSession(page);
  const move = await point(page, '#move-pad', 1, 25);
  const aim = await point(page, '#aim-pad', 2, 25);
  const extra = await point(page, '#move-pad', 3, -25);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move, aim] });
  await expect.poll(async () => (await touchState(page)).firing).toBe(true);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [move, aim, extra],
  });
  await expect.poll(async () => (await touchState(page)).moveX).toBeGreaterThan(0.2);
  await page.locator('#move-pad').evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: Number((element as HTMLElement).dataset.pointer),
        bubbles: true,
      }),
    );
  });
  await expect.poll(async () => (await touchState(page)).moveX).toBeGreaterThan(0.2);
  await page.locator('#aim-pad').evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent('lostpointercapture', {
        pointerId: Number((element as HTMLElement).dataset.pointer),
        bubbles: true,
      }),
    );
  });
  await expect.poll(async () => (await touchState(page)).firing).toBe(false);
  await expect(page.locator('#aim-pad i')).toHaveCSS('transform', 'none');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await touchState(page)).moveX).toBe(0);
});

test('rotation clears held touch and keyboard inputs before the match resumes', async ({
  page,
}) => {
  const client = await page.context().newCDPSession(page);
  const move = await point(page, '#move-pad', 1, 25);
  const aim = await point(page, '#aim-pad', 2, 25);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [move, aim] });
  await page.keyboard.down('d');
  await expect.poll(async () => (await touchState(page)).rightHeld).toBe(true);
  await resizeGameViewport(page, { width: 390, height: 844 });
  await expect(page.locator('#orientation-blocker')).toBeVisible();
  expect(await touchState(page)).toMatchObject({
    moveX: 0,
    wantsJet: false,
    wantsDrop: false,
    firing: false,
    rightHeld: false,
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await resizeGameViewport(page, { width: 844, height: 390 });
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('#resume-button').click();
  expect(await touchState(page)).toMatchObject({ moveX: 0, firing: false, rightHeld: false });
  await page.keyboard.up('d');
});
