import type { Page, CDPSession } from '@playwright/test';

const sessions = new WeakMap<Page, CDPSession>();

// Chromium's native fullscreen window cannot be resized with Browser.setWindowBounds.
// Emulate an actual device rotation without leaving fullscreen or releasing held inputs.
export async function resizeGameViewport(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  if (sessions.has(page) || (await page.evaluate(() => Boolean(document.fullscreenElement)))) {
    const client = sessions.get(page) || (await page.context().newCDPSession(page));
    sessions.set(page, client);
    await client.send('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      mobile: true,
      deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      screenOrientation:
        viewport.width < viewport.height
          ? { type: 'portraitPrimary', angle: 0 }
          : { type: 'landscapePrimary', angle: 90 },
    });
  } else await page.setViewportSize(viewport);
}
