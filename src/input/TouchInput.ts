import type { InputSnapshot } from './actions';

export class TouchInput {
  private aimSensitivity = 1;
  private readonly resets: Array<() => void> = [];
  private readonly state: InputSnapshot = {
    moveX: 0,
    wantsJet: false,
    wantsDrop: false,
    aimX: 1,
    aimY: 0,
    firing: false,
    grenade: false,
  };

  constructor(movePad: HTMLElement, aimPad: HTMLElement, grenadeButton: HTMLElement) {
    this.attachStick(
      movePad,
      (x, y) => {
        this.state.moveX = x;
        this.state.wantsJet = y < -0.22;
        this.state.wantsDrop = y > 0.22;
      },
      () => {
        this.state.moveX = 0;
        this.state.wantsJet = false;
        this.state.wantsDrop = false;
      },
    );
    this.attachStick(
      aimPad,
      (x, y) => {
        const length = Math.hypot(x, y);
        const activationThreshold = 0.18 / this.aimSensitivity;
        if (length > activationThreshold) {
          this.state.aimX = x / length;
          this.state.aimY = y / length;
          this.state.firing = true;
        }
      },
      () => {
        this.state.firing = false;
      },
    );
    grenadeButton.addEventListener('pointerdown', () => {
      this.state.grenade = true;
    });
  }

  reset(): void {
    this.resets.forEach((reset) => reset());
    this.state.grenade = false;
  }

  snapshot(): InputSnapshot {
    const snapshot = { ...this.state };
    this.state.grenade = false;
    return snapshot;
  }

  setAimSensitivity(value: number): void {
    this.aimSensitivity = Math.min(1.8, Math.max(0.5, value));
  }

  private attachStick(
    element: HTMLElement,
    onMove: (x: number, y: number) => void,
    onEnd: () => void,
  ): void {
    const knob = element.querySelector<HTMLElement>('i');
    if (!knob) throw new Error('Touch stick knob is missing');

    let pointer: number | null = null;
    const update = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const radius = rect.width * 0.34;
      const length = Math.max(1, Math.hypot(dx, dy));
      const scale = Math.min(1, radius / length);
      const x = dx * scale;
      const y = dy * scale;
      knob.style.transform = `translate(${x}px, ${y}px)`;
      onMove(x / radius, y / radius);
    };
    const finish = (): void => {
      const previous = pointer;
      pointer = null;
      if (previous !== null && element.hasPointerCapture(previous))
        element.releasePointerCapture(previous);
      knob.style.transform = '';
      onEnd();
    };
    this.resets.push(finish);
    element.addEventListener('pointerdown', (event) => {
      if (pointer !== null) return;
      event.preventDefault();
      pointer = event.pointerId;
      element.setPointerCapture(event.pointerId);
      update(event);
    });
    element.addEventListener('pointermove', (event) => {
      if (pointer === event.pointerId) update(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      element.addEventListener(type, (event) => {
        if (pointer === (event as PointerEvent).pointerId) finish();
      });
    }
  }
}
