import { assetPath, confirmInGame } from '../app/hosting';
import { GRENADES } from '../content/grenades';
import { DIFFICULTIES, DIFFICULTY_IDS } from '../content/difficulties';
import { MAPS, MAP_IDS, MAP_UNLOCK_RANK } from '../content/maps';
import { MODES, MODE_IDS } from '../content/modes';
import { getLoadout, setGrenade } from '../core/state/LoadoutState';
import { getDifficulty, setDifficulty } from '../core/state/DifficultyState';
import { getSelectedMap, setSelectedMap } from '../core/state/MapState';
import { getSelectedMode, setSelectedMode } from '../core/state/ModeState';
import { getSaveRepository, type FlashfireSaveV1 } from '../persistence/SaveRepository';
import type {
  ColorVisionMode,
  GraphicsQuality,
  GrenadeId,
  KeyBindings,
  PerkId,
} from '../core/types/gameplay';
import { KEY_BINDING_CHOICES } from '../input/KeyboardInput';

const PERKS: Record<PerkId, string> = {
  'light-frame': 'Light Frame',
  'fuel-recycler': 'Fuel Recycler',
  'quick-hands': 'Quick Hands',
  'blast-lining': 'Blast Lining',
};

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required lobby element is missing: ${selector}`);
  return element;
}

export class LoadoutController {
  private readonly screen = required<HTMLElement>('#loadout-screen');
  private readonly mapModal = required<HTMLElement>('#map-modal');
  private readonly modeModal = required<HTMLElement>('#mode-modal');
  private readonly settingsModal = required<HTMLElement>('#settings-modal');
  private readonly mapOptions = required<HTMLElement>('#map-options');
  private readonly modeOptions = required<HTMLElement>('#mode-options');
  private readonly grenadeOptions = required<HTMLElement>('#grenade-options');
  private readonly difficultyOptions = required<HTMLElement>('#difficulty-options');
  private readonly profileSummary = required<HTMLElement>('#profile-summary');
  private readonly perkOptions = required<HTMLElement>('#perk-options');
  private readonly graphicsOptions = required<HTMLElement>('#graphics-options');
  private readonly lobbyBackdrop = required<HTMLImageElement>('#lobby-map-backdrop');
  private readonly lobbyMapName = required<HTMLElement>('#lobby-map-name');
  private readonly lobbyMapAmbience = required<HTMLElement>('#lobby-map-ambience');
  private readonly selectedMapImage = required<HTMLImageElement>('#selected-map-image');
  private readonly selectedMapName = required<HTMLElement>('#selected-map-name');
  private readonly selectedMapMechanic = required<HTMLElement>('#selected-map-mechanic');
  private readonly selectedModeName = required<HTMLElement>('#selected-mode-name');
  private readonly selectedModeDescription = required<HTMLElement>('#selected-mode-description');
  private readonly reducedMotion = required<HTMLInputElement>('#reduced-motion-toggle');
  private readonly cameraShake = required<HTMLInputElement>('#camera-shake-slider');
  private readonly colorVision = required<HTMLSelectElement>('#color-vision-select');
  private readonly leftHanded = required<HTMLInputElement>('#left-handed-toggle');
  private readonly gamepadDeadzone = required<HTMLInputElement>('#gamepad-deadzone-slider');
  private readonly gamepadSensitivity = required<HTMLInputElement>('#gamepad-sensitivity-slider');
  private readonly touchSensitivity = required<HTMLInputElement>('#touch-sensitivity-slider');
  private readonly touchSize = required<HTMLInputElement>('#touch-size-slider');
  private readonly touchOpacity = required<HTMLInputElement>('#touch-opacity-slider');
  private readonly pickupContrast = required<HTMLInputElement>('#pickup-contrast-toggle');
  private readonly masterVolume = required<HTMLInputElement>('#master-volume-slider');
  private readonly musicVolume = required<HTMLInputElement>('#music-volume-slider');
  private readonly effectsVolume = required<HTMLInputElement>('#effects-volume-slider');
  private readonly ambienceVolume = required<HTMLInputElement>('#ambience-volume-slider');
  private readonly uiVolume = required<HTMLInputElement>('#ui-volume-slider');
  private readonly bindingOptions = required<HTMLElement>('#binding-options');
  readonly deploy = required<HTMLButtonElement>('#deploy-button');

  constructor() {
    this.renderGrenades();
    this.renderDifficulties();
    this.renderMaps();
    this.renderModes();
    this.renderPerks();
    this.renderGraphics();
    this.renderAccessibility();
    this.bindLobbyShell();
    this.bindSaveActions();
    this.refresh();
  }

  open(): void {
    this.closeModals();
    this.refresh();
    this.screen.classList.remove('hidden');
  }

  close(): void {
    this.closeModals();
    this.screen.classList.add('hidden');
  }

  private bindLobbyShell(): void {
    required<HTMLButtonElement>('#lobby-back-button').addEventListener('click', () =>
      window.dispatchEvent(new Event('flashfire:navigate-home')),
    );
    required<HTMLButtonElement>('#arena-selector-button').addEventListener('click', () =>
      this.openModal(this.mapModal),
    );
    required<HTMLButtonElement>('#mode-selector-button').addEventListener('click', () =>
      this.openModal(this.modeModal),
    );
    required<HTMLButtonElement>('#settings-button').addEventListener('click', () =>
      this.openModal(this.settingsModal),
    );
    this.screen.querySelectorAll<HTMLButtonElement>('.modal-close').forEach((button) => {
      button.addEventListener('click', () =>
        button.closest<HTMLElement>('.lobby-modal')?.classList.add('hidden'),
      );
    });
    this.screen.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
      button.addEventListener('click', () =>
        this.showSettingsTab(button.dataset.settingsTab ?? 'gameplay'),
      );
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.screen.classList.contains('hidden')) return;
      const openModal = [this.mapModal, this.modeModal, this.settingsModal].find(
        (modal) => !modal.classList.contains('hidden'),
      );
      if (openModal) openModal.classList.add('hidden');
      else window.dispatchEvent(new Event('flashfire:navigate-home'));
    });
  }

  private openModal(modal: HTMLElement): void {
    this.closeModals();
    modal.classList.remove('hidden');
  }

  private closeModals(): void {
    [this.mapModal, this.modeModal, this.settingsModal].forEach((modal) =>
      modal.classList.add('hidden'),
    );
  }

  private showSettingsTab(tab: string): void {
    this.settingsModal
      .querySelectorAll<HTMLElement>('[data-settings-panel]')
      .forEach((panel) => panel.classList.toggle('hidden', panel.dataset.settingsPanel !== tab));
    this.settingsModal
      .querySelectorAll<HTMLElement>('[data-settings-tab]')
      .forEach((button) => button.classList.toggle('selected', button.dataset.settingsTab === tab));
  }

  private renderGrenades(): void {
    (Object.keys(GRENADES) as GrenadeId[]).forEach((grenadeId) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.grenadeId = grenadeId;
      button.textContent = GRENADES[grenadeId].displayName;
      button.addEventListener('click', () => {
        setGrenade(grenadeId);
        this.refresh();
      });
      this.grenadeOptions.append(button);
    });
  }

  private renderDifficulties(): void {
    DIFFICULTY_IDS.forEach((difficultyId) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.difficultyId = difficultyId;
      button.textContent = DIFFICULTIES[difficultyId].displayName;
      button.addEventListener('click', () => {
        setDifficulty(difficultyId);
        this.refresh();
      });
      this.difficultyOptions.append(button);
    });
  }

  private renderMaps(): void {
    MAP_IDS.forEach((mapId) => {
      const map = MAPS[mapId];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-option';
      button.dataset.mapId = mapId;
      button.innerHTML = `<img src="${assetPath(map.previewPath)}" alt="" /><span><b>${map.displayName}</b><small>${map.mechanic}</small></span>`;
      button.addEventListener('click', () => {
        setSelectedMap(mapId);
        this.refresh();
        this.mapModal.classList.add('hidden');
      });
      this.mapOptions.append(button);
    });
  }

  private renderModes(): void {
    MODE_IDS.forEach((modeId) => {
      const mode = MODES[modeId];
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.modeId = modeId;
      button.innerHTML = `<b>${mode.displayName}</b><small>${mode.description}</small>`;
      button.addEventListener('click', () => {
        setSelectedMode(modeId);
        this.refresh();
        this.modeModal.classList.add('hidden');
      });
      this.modeOptions.append(button);
    });
  }

  private renderPerks(): void {
    (Object.keys(PERKS) as PerkId[]).forEach((perkId) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.perkId = perkId;
      button.textContent = PERKS[perkId];
      button.addEventListener('click', () => {
        const repository = getSaveRepository();
        const save = repository.load();
        if (!save.unlocks.perks.includes(perkId)) return;
        save.settings.selectedPerk = save.settings.selectedPerk === perkId ? null : perkId;
        repository.save(save);
        this.refresh();
      });
      this.perkOptions.append(button);
    });
  }

  private renderGraphics(): void {
    (['auto', 'low', 'medium', 'high'] as GraphicsQuality[]).forEach((quality) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.quality = quality;
      button.textContent = quality.toUpperCase();
      button.addEventListener('click', () => {
        const repository = getSaveRepository();
        const save = repository.load();
        save.settings.graphicsQuality = quality;
        repository.save(save);
        this.refresh();
      });
      this.graphicsOptions.append(button);
    });
    this.reducedMotion.addEventListener('change', () =>
      this.updateSetting('reducedMotion', this.reducedMotion.checked),
    );
    this.cameraShake.addEventListener('input', () =>
      this.updateSetting('cameraShake', Number(this.cameraShake.value)),
    );
  }

  private renderAccessibility(): void {
    const labels: Record<keyof KeyBindings, string> = {
      left: 'MOVE LEFT',
      right: 'MOVE RIGHT',
      jet: 'MOVE UP',
      down: 'MOVE DOWN',
      reload: 'RELOAD',
      grenade: 'GRENADE',
      pause: 'PAUSE',
    };
    (Object.keys(labels) as Array<keyof KeyBindings>).forEach((action) => {
      const label = document.createElement('label');
      const select = document.createElement('select');
      select.dataset.binding = action;
      KEY_BINDING_CHOICES.forEach((choice) =>
        select.add(new Option(choice.replace('ARROW', 'ARROW '), choice)),
      );
      select.addEventListener('change', () => {
        const repository = getSaveRepository();
        const save = repository.load();
        save.settings.keyBindings[action] = select.value;
        repository.save(save);
      });
      label.append(labels[action], select);
      this.bindingOptions.append(label);
    });
    this.colorVision.addEventListener('change', () =>
      this.updateSetting('colorVision', this.colorVision.value as ColorVisionMode),
    );
    this.leftHanded.addEventListener('change', () =>
      this.updateSetting('leftHandedTouch', this.leftHanded.checked),
    );
    this.gamepadDeadzone.addEventListener('input', () =>
      this.updateSetting('gamepadDeadzone', Number(this.gamepadDeadzone.value)),
    );
    this.gamepadSensitivity.addEventListener('input', () =>
      this.updateSetting('gamepadSensitivity', Number(this.gamepadSensitivity.value)),
    );
    this.touchSensitivity.addEventListener('input', () =>
      this.updateSetting('touchAimSensitivity', Number(this.touchSensitivity.value)),
    );
    this.touchSize.addEventListener('input', () =>
      this.updateSetting('touchControlSize', Number(this.touchSize.value)),
    );
    this.touchOpacity.addEventListener('input', () =>
      this.updateSetting('touchControlOpacity', Number(this.touchOpacity.value)),
    );
    this.pickupContrast.addEventListener('change', () =>
      this.updateSetting('highContrastPickups', this.pickupContrast.checked),
    );
    this.masterVolume.addEventListener('input', () =>
      this.updateSetting('masterVolume', Number(this.masterVolume.value)),
    );
    this.musicVolume.addEventListener('input', () =>
      this.updateSetting('musicVolume', Number(this.musicVolume.value)),
    );
    this.effectsVolume.addEventListener('input', () =>
      this.updateSetting('effectsVolume', Number(this.effectsVolume.value)),
    );
    this.ambienceVolume.addEventListener('input', () =>
      this.updateSetting('ambienceVolume', Number(this.ambienceVolume.value)),
    );
    this.uiVolume.addEventListener('input', () =>
      this.updateSetting('uiVolume', Number(this.uiVolume.value)),
    );
  }

  private updateSetting<K extends keyof FlashfireSaveV1['settings']>(
    key: K,
    value: FlashfireSaveV1['settings'][K],
  ): void {
    const repository = getSaveRepository();
    const save = repository.load();
    save.settings[key] = value;
    repository.save(save);
    this.applyAccessibility(save);
  }

  private applyAccessibility(save: FlashfireSaveV1): void {
    document.documentElement.dataset.colorVision = save.settings.colorVision;
    document.documentElement.classList.toggle('left-handed', save.settings.leftHandedTouch);
    document.documentElement.style.setProperty(
      '--touch-size',
      String(save.settings.touchControlSize),
    );
    document.documentElement.style.setProperty(
      '--touch-opacity',
      String(save.settings.touchControlOpacity),
    );
  }

  private bindSaveActions(): void {
    const repository = getSaveRepository();
    required<HTMLButtonElement>('#export-save-button').addEventListener('click', () => {
      const blob = new Blob([repository.exportJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'flashfire-save.json';
      anchor.click();
      URL.revokeObjectURL(url);
    });
    const input = required<HTMLInputElement>('#import-save-input');
    required<HTMLButtonElement>('#import-save-button').addEventListener('click', () =>
      input.click(),
    );
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file && repository.importJson(await file.text())) this.refresh();
      input.value = '';
    });
    required<HTMLButtonElement>('#reset-save-button').addEventListener('click', async () => {
      if (await confirmInGame('Reset Flashfire progression for this visit?')) {
        repository.reset();
        this.refresh();
      }
    });
  }

  private refresh(): void {
    const loadout = getLoadout();
    const save = getSaveRepository().load();
    const selectedMap = MAPS[getSelectedMap()];
    const selectedMode = MODES[getSelectedMode()];

    this.lobbyBackdrop.src = assetPath(`/assets/maps/${selectedMap.id}-background.jpg`);
    this.lobbyMapName.textContent = selectedMap.displayName;
    this.lobbyMapAmbience.textContent = selectedMap.ambience.toUpperCase();
    this.selectedMapImage.src = assetPath(selectedMap.previewPath);
    this.selectedMapName.textContent = selectedMap.displayName;
    this.selectedMapMechanic.textContent = selectedMap.mechanic;
    this.selectedModeName.textContent = selectedMode.displayName.toUpperCase();
    this.selectedModeDescription.textContent = selectedMode.description;

    this.grenadeOptions
      .querySelectorAll<HTMLElement>('[data-grenade-id]')
      .forEach((option) =>
        option.classList.toggle('selected', option.dataset.grenadeId === loadout.grenade),
      );
    this.difficultyOptions
      .querySelectorAll<HTMLElement>('[data-difficulty-id]')
      .forEach((option) =>
        option.classList.toggle('selected', option.dataset.difficultyId === getDifficulty()),
      );
    this.mapOptions.querySelectorAll<HTMLButtonElement>('[data-map-id]').forEach((option) => {
      const mapId = option.dataset.mapId as (typeof MAP_IDS)[number];
      const unlocked = save.unlocks.maps.includes(mapId);
      option.classList.toggle('selected', mapId === selectedMap.id);
      option.disabled = !unlocked;
      option.title = unlocked ? MAPS[mapId].mechanic : `Unlocks at rank ${MAP_UNLOCK_RANK[mapId]}`;
    });
    this.modeOptions
      .querySelectorAll<HTMLElement>('[data-mode-id]')
      .forEach((option) =>
        option.classList.toggle('selected', option.dataset.modeId === selectedMode.id),
      );
    this.perkOptions.querySelectorAll<HTMLButtonElement>('[data-perk-id]').forEach((option) => {
      const perkId = option.dataset.perkId as PerkId;
      const unlocked = save.unlocks.perks.includes(perkId);
      option.disabled = !unlocked;
      option.classList.toggle('selected', save.settings.selectedPerk === perkId);
      option.title = unlocked ? PERKS[perkId] : 'Unlocks through rank progression';
    });
    this.graphicsOptions
      .querySelectorAll<HTMLButtonElement>('[data-quality]')
      .forEach((option) =>
        option.classList.toggle(
          'selected',
          option.dataset.quality === save.settings.graphicsQuality,
        ),
      );
    this.reducedMotion.checked = save.settings.reducedMotion;
    this.cameraShake.value = String(save.settings.cameraShake);
    this.colorVision.value = save.settings.colorVision;
    this.leftHanded.checked = save.settings.leftHandedTouch;
    this.gamepadDeadzone.value = String(save.settings.gamepadDeadzone);
    this.gamepadSensitivity.value = String(save.settings.gamepadSensitivity);
    this.touchSensitivity.value = String(save.settings.touchAimSensitivity);
    this.touchSize.value = String(save.settings.touchControlSize);
    this.touchOpacity.value = String(save.settings.touchControlOpacity);
    this.pickupContrast.checked = save.settings.highContrastPickups;
    this.masterVolume.value = String(save.settings.masterVolume);
    this.musicVolume.value = String(save.settings.musicVolume);
    this.effectsVolume.value = String(save.settings.effectsVolume);
    this.ambienceVolume.value = String(save.settings.ambienceVolume);
    this.uiVolume.value = String(save.settings.uiVolume);
    this.bindingOptions.querySelectorAll<HTMLSelectElement>('[data-binding]').forEach((select) => {
      select.value = save.settings.keyBindings[select.dataset.binding as keyof KeyBindings];
    });
    this.applyAccessibility(save);
    this.profileSummary.textContent = `RANK ${save.profile.rank}  |  ${save.profile.experience} XP  |  ${DIFFICULTIES[getDifficulty()].displayName.toUpperCase()}`;
  }
}
