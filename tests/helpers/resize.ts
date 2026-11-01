import type { Page } from '@playwright/test';

// Chromium's native fullscreen window cannot be resized with Browser.setWindowBounds.
// Emulate an actual device rotation without leaving fullscreen or releasing held inputs.
export async function resizeGameViewport(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  if (await page.evaluate(() => Boolean(document.fullscreenElement))) {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      mobile: true,
      deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    await client.detach();
  } else await page.setViewportSize(viewport);
}
