export const hosted = location.pathname.startsWith('/games/flashfire/');
export function assetPath(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
export function boundedViewport(
  width = innerWidth,
  height = innerHeight,
): { width: number; height: number } {
  let common = width,
    divisor = height;
  while (divisor) {
    const remainder = common % divisor;
    common = divisor;
    divisor = remainder;
  }
  let ratio = Math.min(1, Math.sqrt(3_600_000 / Math.max(1, width * height)));
  // Keep common display ratios exact while bounding the physical canvas.
  if (common > 1 && Math.floor(common * ratio) > 0) ratio = Math.floor(common * ratio) / common;
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}
const parentOrigin = new URL(document.referrer || location.href).origin;
let attempt = new URLSearchParams(location.search).get('launch') || 'flashfire:0';
let ready = false;
export function reportReady(complete = false): void {
  ready ||= complete;
  if (parent === window) return;
  parent.postMessage(
    {
      type: 'utxoplay:load',
      game: 'flashfire',
      attempt,
      progress: ready ? 100 : 35,
      phase: ready ? 'Ready to deploy' : 'Loading the arena',
      detail: 'Flashfire by Hallab',
      steps: [true, ready, ready, ready],
      error: '',
      ready,
    },
    parentOrigin,
  );
}
addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.origin !== parentOrigin ||
    event.data?.type !== 'utxoplay:load-request' ||
    !/^flashfire:\d+$/.test(event.data.attempt)
  )
    return;
  attempt = event.data.attempt;
  reportReady();
});
export function exitToStore(): void {
  if (parent !== window)
    parent.postMessage({ type: 'utxoplay:exit', game: 'flashfire', attempt }, parentOrigin);
  else location.assign('https://store.utxoplay.io/');
}
export async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    await (
      screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> }
    ).lock?.('landscape');
  } catch {
    /* The portrait gate supplies a manual-rotation fallback. */
  }
}
export function confirmInGame(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'host-confirm';
    dialog.setAttribute('aria-label', 'Confirm action');
    const text = document.createElement('p');
    text.textContent = message;
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.textContent = 'Confirm';
    const finish = (value: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.onclick = () => finish(false);
    confirm.onclick = () => finish(true);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.append(text, cancel, confirm);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
