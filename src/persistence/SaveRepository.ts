import { MODE_IDS } from '../content/modes';
import { MAP_IDS, MAP_UNLOCK_RANK } from '../content/maps';
import { WEAPON_IDS } from '../content/weapons';
import type {
  DifficultyId,
  ColorVisionMode,
  GraphicsQuality,
  KeyBindings,
  MapId,
  ModeId,
  PerkId,
  WeaponId,
} from '../core/types/gameplay';
import { KEY_BINDING_CHOICES } from '../input/KeyboardInput';

export const SAVE_KEY = 'flashfire.save';

export interface WeaponMasteryState {
  eliminations: number;
  level: 1 | 2 | 3;
}
export interface ModeRecord {
  matches: number;
  wins: number;
  bestScore: number;
}
export interface ChallengeState {
  id: string;
  current: number;
  target: number;
  completed: boolean;
}
export interface FlashfireSaveV1 {
  version: 1;
  profile: { displayName: string; rank: number; experience: number; totalMatches: number };
  unlocks: {
    maps: MapId[];
    modes: ModeId[];
    difficulties: DifficultyId[];
    weapons: WeaponId[];
    perks: PerkId[];
  };
  mastery: Record<WeaponId, WeaponMasteryState>;
  records: Record<ModeId, ModeRecord>;
  challenges: ChallengeState[];
  settings: {
    selectedPerk: PerkId | null;
    graphicsQuality: GraphicsQuality;
    reducedMotion: boolean;
    cameraShake: number;
    keyBindings: KeyBindings;
    gamepadDeadzone: number;
    gamepadSensitivity: number;
    touchAimSensitivity: number;
    touchControlSize: number;
    touchControlOpacity: number;
    leftHandedTouch: boolean;
    highContrastPickups: boolean;
    colorVision: ColorVisionMode;
    masterVolume: number;
    musicVolume: number;
    effectsVolume: number;
    ambienceVolume: number;
    uiVolume: number;
  };
}

export interface MatchRewardInput {
  modeId: ModeId;
  weaponId: WeaponId;
  victory: boolean;
  eliminations: number;
  score: number;
  difficultyMultiplier: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function blankMastery(): Record<WeaponId, WeaponMasteryState> {
  return Object.fromEntries(WEAPON_IDS.map((id) => [id, { eliminations: 0, level: 1 }])) as Record<
    WeaponId,
    WeaponMasteryState
  >;
}

function blankRecords(): Record<ModeId, ModeRecord> {
  return Object.fromEntries(
    MODE_IDS.map((id) => [id, { matches: 0, wins: 0, bestScore: 0 }]),
  ) as Record<ModeId, ModeRecord>;
}

export function createDefaultSave(): FlashfireSaveV1 {
  return {
    version: 1,
    profile: { displayName: 'Ranger', rank: 1, experience: 0, totalMatches: 0 },
    unlocks: {
      maps: MAP_IDS.filter((id) => !MAP_UNLOCK_RANK[id]),
      modes: [...MODE_IDS],
      difficulties: ['recruit', 'regular', 'veteran', 'elite', 'flashpoint'],
      weapons: [...WEAPON_IDS],
      perks: [],
    },
    mastery: blankMastery(),
    records: blankRecords(),
    challenges: [
      { id: 'eliminations-25', current: 0, target: 25, completed: false },
      { id: 'matches-5', current: 0, target: 5, completed: false },
      { id: 'wins-3', current: 0, target: 3, completed: false },
    ],
    settings: {
      selectedPerk: null,
      graphicsQuality: 'auto',
      reducedMotion: false,
      cameraShake: 1,
      keyBindings: {
        left: 'A',
        right: 'D',
        jet: 'W',
        down: 'S',
        reload: 'R',
        grenade: 'G',
        pause: 'ESC',
      },
      gamepadDeadzone: 0.18,
      gamepadSensitivity: 1,
      touchAimSensitivity: 1,
      touchControlSize: 1,
      touchControlOpacity: 0.75,
      leftHandedTouch: false,
      highContrastPickups: true,
      colorVision: 'default',
      masterVolume: 0.8,
      musicVolume: 0.65,
      effectsVolume: 0.8,
      ambienceVolume: 0.65,
      uiVolume: 0.8,
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function enumSetting<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function numberSetting(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function isValidSave(value: unknown): value is FlashfireSaveV1 {
  if (!value || typeof value !== 'object') return false;
  const save = value as Partial<FlashfireSaveV1>;
  if (
    save.version !== 1 ||
    !save.profile ||
    !save.unlocks ||
    !save.mastery ||
    !save.records ||
    !save.settings
  )
    return false;
  return (
    Number.isInteger(save.profile.rank) &&
    save.profile.rank >= 1 &&
    save.profile.rank <= 30 &&
    Number.isFinite(save.profile.experience) &&
    save.profile.experience >= 0 &&
    Number.isInteger(save.profile.totalMatches) &&
    save.profile.totalMatches >= 0 &&
    isStringArray(save.unlocks.maps) &&
    isStringArray(save.unlocks.modes) &&
    isStringArray(save.unlocks.difficulties) &&
    isStringArray(save.unlocks.weapons) &&
    isStringArray(save.unlocks.perks) &&
    WEAPON_IDS.every((id) => Number.isFinite(save.mastery?.[id]?.eliminations)) &&
    MODE_IDS.every((id) => Number.isFinite(save.records?.[id]?.matches))
  );
}

function normalizeSave(value: FlashfireSaveV1): FlashfireSaveV1 {
  const defaults = createDefaultSave().settings;
  const source = value.settings as Partial<FlashfireSaveV1['settings']>;
  const suppliedBindings: Partial<KeyBindings> =
    source.keyBindings && typeof source.keyBindings === 'object' ? source.keyBindings : {};
  const binding = (action: keyof KeyBindings): string =>
    enumSetting(suppliedBindings[action], KEY_BINDING_CHOICES, defaults.keyBindings[action]);
  return {
    ...value,
    challenges: Array.isArray(value.challenges) ? value.challenges : createDefaultSave().challenges,
    settings: {
      ...defaults,
      selectedPerk: ['light-frame', 'fuel-recycler', 'quick-hands', 'blast-lining'].includes(
        source.selectedPerk ?? '',
      )
        ? (source.selectedPerk ?? null)
        : null,
      graphicsQuality: enumSetting(
        source.graphicsQuality,
        ['auto', 'low', 'medium', 'high'],
        defaults.graphicsQuality,
      ),
      reducedMotion: booleanSetting(source.reducedMotion, defaults.reducedMotion),
      cameraShake: numberSetting(source.cameraShake, defaults.cameraShake, 0, 1),
      keyBindings: {
        left: binding('left'),
        right: binding('right'),
        jet: binding('jet'),
        down: binding('down'),
        reload: binding('reload'),
        grenade: binding('grenade'),
        pause: binding('pause'),
      },
      gamepadDeadzone: numberSetting(source.gamepadDeadzone, defaults.gamepadDeadzone, 0.05, 0.4),
      gamepadSensitivity: numberSetting(
        source.gamepadSensitivity,
        defaults.gamepadSensitivity,
        0.5,
        1.8,
      ),
      touchAimSensitivity: numberSetting(
        source.touchAimSensitivity,
        defaults.touchAimSensitivity,
        0.5,
        1.8,
      ),
      touchControlSize: numberSetting(
        source.touchControlSize,
        defaults.touchControlSize,
        0.75,
        1.25,
      ),
      touchControlOpacity: numberSetting(
        source.touchControlOpacity,
        defaults.touchControlOpacity,
        0.35,
        1,
      ),
      leftHandedTouch: booleanSetting(source.leftHandedTouch, defaults.leftHandedTouch),
      highContrastPickups: booleanSetting(source.highContrastPickups, defaults.highContrastPickups),
      colorVision: enumSetting(
        source.colorVision,
        ['default', 'deuteranopia', 'protanopia', 'tritanopia'],
        defaults.colorVision,
      ),
      masterVolume: numberSetting(source.masterVolume, defaults.masterVolume, 0, 1),
      musicVolume: numberSetting(source.musicVolume, defaults.musicVolume, 0, 1),
      effectsVolume: numberSetting(source.effectsVolume, defaults.effectsVolume, 0, 1),
      ambienceVolume: numberSetting(source.ambienceVolume, defaults.ambienceVolume, 0, 1),
      uiVolume: numberSetting(source.uiVolume, defaults.uiVolume, 0, 1),
    },
  };
}

export function migrateSaveDocument(value: unknown): FlashfireSaveV1 | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { version?: number; profile?: Partial<FlashfireSaveV1['profile']> };
  if (candidate.version === 0) {
    const migrated = createDefaultSave();
    migrated.profile = { ...migrated.profile, ...candidate.profile };
    migrated.profile.rank = Math.min(30, Math.max(1, migrated.profile.rank));
    return migrated;
  }
  return isValidSave(value) ? normalizeSave(value) : null;
}

export function rankForExperience(experience: number): number {
  return Math.min(30, Math.max(1, Math.floor(Math.sqrt(Math.max(0, experience) / 125)) + 1));
}

export function applyMatchReward(save: FlashfireSaveV1, input: MatchRewardInput): FlashfireSaveV1 {
  const next = structuredClone(save);
  const earned = Math.round(
    (100 + input.eliminations * 18 + (input.victory ? 125 : 0)) * input.difficultyMultiplier,
  );
  next.profile.experience += earned;
  next.profile.rank = rankForExperience(next.profile.experience);
  next.profile.totalMatches += 1;
  const mastery = next.mastery[input.weaponId];
  mastery.eliminations += input.eliminations;
  mastery.level = mastery.eliminations >= 120 ? 3 : mastery.eliminations >= 40 ? 2 : 1;
  const record = next.records[input.modeId];
  record.matches += 1;
  record.wins += Number(input.victory);
  record.bestScore = Math.max(record.bestScore, Math.round(input.score));
  const increments: Record<string, number> = {
    'eliminations-25': input.eliminations,
    'matches-5': 1,
    'wins-3': Number(input.victory),
  };
  next.challenges.forEach((challenge) => {
    challenge.current = Math.min(
      challenge.target,
      challenge.current + (increments[challenge.id] ?? 0),
    );
    challenge.completed = challenge.current >= challenge.target;
  });
  const perkUnlocks: Array<[number, PerkId]> = [
    [5, 'light-frame'],
    [10, 'fuel-recycler'],
    [15, 'quick-hands'],
    [20, 'blast-lining'],
  ];
  perkUnlocks.forEach(([rank, perk]) => {
    if (next.profile.rank >= rank && !next.unlocks.perks.includes(perk))
      next.unlocks.perks.push(perk);
  });
  MAP_IDS.forEach((mapId) => {
    if (next.profile.rank >= (MAP_UNLOCK_RANK[mapId] ?? 1) && !next.unlocks.maps.includes(mapId)) {
      next.unlocks.maps.push(mapId);
    }
  });
  return next;
}

export class SaveRepository {
  private lastValid: FlashfireSaveV1 = createDefaultSave();

  constructor(private readonly storage: StorageLike) {}

  load(): FlashfireSaveV1 {
    const raw = this.storage.getItem(SAVE_KEY);
    if (!raw) return this.persistDefault();
    try {
      const value = JSON.parse(raw) as { version?: number };
      if (typeof value.version === 'number' && value.version > 1)
        return structuredClone(this.lastValid);
      const normalized = migrateSaveDocument(value);
      if (!normalized) return this.persistDefault();
      this.lastValid = structuredClone(normalized);
      this.save(normalized);
      return structuredClone(normalized);
    } catch {
      return this.persistDefault();
    }
  }

  save(value: FlashfireSaveV1): boolean {
    if (!isValidSave(value)) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(value));
      this.lastValid = structuredClone(value);
      return true;
    } catch {
      return false;
    }
  }

  exportJson(): string {
    return JSON.stringify(this.load(), null, 2);
  }

  importJson(raw: string): boolean {
    try {
      const value = JSON.parse(raw) as unknown;
      const migrated = migrateSaveDocument(value);
      return migrated ? this.save(migrated) : false;
    } catch {
      return false;
    }
  }

  reset(): FlashfireSaveV1 {
    this.storage.removeItem(SAVE_KEY);
    return this.persistDefault();
  }

  private persistDefault(): FlashfireSaveV1 {
    const fallback = createDefaultSave();
    this.save(fallback);
    return fallback;
  }
}

let browserRepository: SaveRepository | null = null;
export function getSaveRepository(): SaveRepository {
  if (!browserRepository) {
    let storage: StorageLike;
    try {
      storage = window.localStorage;
      storage.setItem('flashfire.storage-test', '1');
      storage.removeItem('flashfire.storage-test');
    } catch {
      const values = new Map<string, string>();
      storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
        removeItem: (key) => {
          values.delete(key);
        },
      };
    }
    browserRepository = new SaveRepository(storage);
  }
  return browserRepository;
}
