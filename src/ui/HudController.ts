import { assetPath } from '../app/hosting';
import { WEAPONS } from '../content/weapons';
import { GRENADES } from '../content/grenades';
import type { MatchSnapshot } from '../core/types/gameplay';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

export class HudController {
  readonly hud = required<HTMLElement>('#hud');
  readonly feed = required<HTMLElement>('#kill-feed');
  readonly flash = required<HTMLElement>('#damage-flash');
  readonly start = required<HTMLElement>('#start-screen');
  readonly play = required<HTMLButtonElement>('#play-button');
  readonly result = required<HTMLElement>('#result-screen');
  readonly resultTitle = required<HTMLElement>('#result-title');
  readonly resultScore = required<HTMLElement>('#result-score');
  readonly restart = required<HTMLButtonElement>('#restart-button');
  readonly finishSession = required<HTMLButtonElement>('#finish-session-button');
  readonly pause = required<HTMLElement>('#pause-screen');
  readonly pauseButton = required<HTMLButtonElement>('#pause-button');
  readonly resume = required<HTMLButtonElement>('#resume-button');
  readonly mobileControls = required<HTMLElement>('#mobile-controls');
  readonly weaponSlots = required<HTMLElement>('#weapon-slots');
  readonly pickupPrompt = required<HTMLButtonElement>('#pickup-prompt');
  private readonly weaponSlotButtons = Array.from(
    this.weaponSlots.querySelectorAll<HTMLButtonElement>('[data-weapon-slot]'),
  );
  private readonly healthBar = required<HTMLElement>('#health-bar');
  private readonly healthValue = required<HTMLElement>('#health-value');
  private readonly armorBar = required<HTMLElement>('#armor-bar');
  private readonly armorValue = required<HTMLElement>('#armor-value');
  private readonly fuelBar = required<HTMLElement>('#fuel-bar');
  private readonly fuelValue = required<HTMLElement>('#fuel-value');
  private readonly playerScore = required<HTMLElement>('#player-score');
  private readonly enemyScore = required<HTMLElement>('#enemy-score');
  private readonly matchTime = required<HTMLElement>('#match-time');
  private readonly weaponName = required<HTMLElement>('#weapon-name');
  private readonly reloadState = required<HTMLElement>('#reload-state');
  private readonly ammoValue = required<HTMLElement>('#ammo-value');
  private readonly grenadeState = required<HTMLElement>('#grenade-state');
  private readonly modeLabel = required<HTMLElement>('.score-card small');
  private readonly resultStats = required<HTMLElement>('#result-stats');

  showMenu(): void {
    this.start.classList.remove('hidden');
    this.result.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.pauseButton.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.mobileControls.classList.add('hidden');
    this.weaponSlots.classList.add('hidden');
    this.hideWeaponPickup();
    this.finishSession.classList.add('hidden');
  }

  showMatch(): void {
    this.start.classList.add('hidden');
    this.result.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.pauseButton.classList.remove('hidden');
    this.hud.classList.remove('hidden');
    this.mobileControls.classList.remove('hidden');
    this.weaponSlots.classList.remove('hidden');
  }

  showPause(paused: boolean): void {
    this.pause.classList.toggle('hidden', !paused);
    this.pauseButton.classList.toggle('hidden', paused);
    this.mobileControls.classList.toggle('hidden', paused);
    this.weaponSlots.classList.toggle('hidden', paused);
    if (paused) this.hideWeaponPickup();
  }

  showResult(victory: boolean, playerScore: number, enemyScore: number, stats = ''): void {
    this.resultTitle.textContent = victory ? 'VICTORY' : 'DEFEAT';
    this.resultTitle.style.color = victory ? '#f2c15a' : '#ef705c';
    this.resultScore.textContent = `${playerScore} - ${enemyScore}`;
    this.resultStats.textContent = stats;
    this.result.classList.remove('hidden');
    this.pauseButton.classList.add('hidden');
    this.mobileControls.classList.add('hidden');
    this.weaponSlots.classList.add('hidden');
    this.hideWeaponPickup();
    this.finishSession.classList.add('hidden');
  }

  setTrainingSession(active: boolean): void {
    this.finishSession.classList.toggle('hidden', !active);
  }

  update(snapshot: MatchSnapshot): void {
    const weapon = WEAPONS[snapshot.weaponId];
    this.healthBar.style.width = `${snapshot.playerHealth}%`;
    this.healthValue.textContent = String(Math.ceil(snapshot.playerHealth));
    this.armorBar.style.width = `${snapshot.playerArmor * 2}%`;
    this.armorValue.textContent = String(Math.ceil(snapshot.playerArmor));
    this.fuelBar.style.width = `${snapshot.playerFuel}%`;
    this.fuelValue.textContent = String(Math.ceil(snapshot.playerFuel));
    this.playerScore.textContent = String(snapshot.playerScore);
    this.enemyScore.textContent = String(snapshot.enemyScore);
    const seconds = Math.ceil(snapshot.timeLeft);
    this.matchTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    this.weaponName.textContent = weapon.displayName;
    this.reloadState.textContent = snapshot.reloading ? 'RELOADING' : weapon.fireModeLabel;
    this.reloadState.style.color = snapshot.reloading ? '#f2c15a' : '';
    this.ammoValue.textContent = `${snapshot.ammo.mag} / ${snapshot.ammo.reserve}`;
    this.grenadeState.textContent = `${GRENADES[snapshot.grenadeId].displayName} x${snapshot.grenades}`;
    this.modeLabel.textContent = snapshot.modeLabel;
    this.weaponSlotButtons.forEach((button, index) => {
      const weaponId = snapshot.weaponSlots[index];
      button.classList.toggle('empty', !weaponId);
      button.classList.toggle('active', weaponId === snapshot.weaponId);
      button.disabled = !weaponId;
      const image = button.querySelector<HTMLImageElement>('img');
      const label = button.querySelector<HTMLElement>('span');
      if (image) {
        image.src = weaponId ? assetPath(`/assets/${WEAPONS[weaponId].spriteKey}.png`) : '';
        image.hidden = !weaponId;
      }
      if (label) label.textContent = weaponId ? WEAPONS[weaponId].displayName : 'EMPTY';
    });
  }

  showWeaponPickup(weaponId: keyof typeof WEAPONS): void {
    const weapon = WEAPONS[weaponId];
    const image = this.pickupPrompt.querySelector<HTMLImageElement>('img');
    const label = this.pickupPrompt.querySelector<HTMLElement>('b');
    if (image) image.src = assetPath(`/assets/${weapon.spriteKey}.png`);
    if (label) label.textContent = weapon.displayName;
    this.pickupPrompt.setAttribute('aria-label', `Pick up ${weapon.displayName}`);
    this.pickupPrompt.classList.remove('hidden');
  }

  hideWeaponPickup(): void {
    this.pickupPrompt.classList.add('hidden');
  }

  addFeed(html: string): void {
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = html;
    this.feed.prepend(item);
    window.setTimeout(() => item.remove(), 3100);
  }

  damageFlash(): void {
    this.flash.classList.add('active');
    window.setTimeout(() => this.flash.classList.remove('active'), 55);
  }
}
