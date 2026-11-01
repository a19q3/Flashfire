import { assetPath, reportReady } from '../app/hosting';
const bundledMaps = import.meta.glob('/public/assets/maps/*.json', {
  eager: true,
  import: 'default',
});
import Phaser from 'phaser';
import { chooseBehavior, reactionDelay } from '../ai/BotBrain';
import { hasLineOfSight, type RectangleObstacle, type SmokeZone } from '../ai/BotPerception';
import { NavigationGraph } from '../ai/NavigationGraph';
import { DIFFICULTIES, type DifficultyDefinition } from '../content/difficulties';
import { WEAPONS, WEAPON_IDS } from '../content/weapons';
import { GRENADES } from '../content/grenades';
import { MAPS, MAP_IDS, type MapDefinition } from '../content/maps';
import { MAP_AMBIENCE } from '../content/audio';
import { MODES, type ModeDefinition } from '../content/modes';
import { EventBus } from '../core/events/EventBus';
import type { GameEventMap } from '../core/events/GameEvents';
import { FixedStepRunner } from '../core/math/fixedStep';
import { SeededRandom } from '../core/math/seededRandom';
import { MatchStateMachine } from '../core/state/MatchStateMachine';
import { getLoadout } from '../core/state/LoadoutState';
import { getDifficulty } from '../core/state/DifficultyState';
import { getSelectedMap } from '../core/state/MapState';
import { getSelectedMode } from '../core/state/ModeState';
import type {
  ColorVisionMode,
  KeyBindings,
  PerkId,
  PickupId,
  SpawnPoint,
  TeamId,
  WeaponId,
} from '../core/types/gameplay';
import { getSaveRepository, applyMatchReward } from '../persistence/SaveRepository';
import { actorId, createInventory, type ActorSprite } from '../entities/Actor';
import type { ProjectileSprite } from '../entities/Projectile';
import { TouchInput } from '../input/TouchInput';
import { applyGamepadDeadzone, gamepadAimAngle } from '../input/GamepadInput';
import { toPhaserKeyName } from '../input/KeyboardInput';
import {
  applyBulletDamage,
  applyDamage as reduceHealth,
  hitRegionForOffset,
  radialDamage,
} from '../systems/DamageSystem';
import { chooseSafestSpawn } from '../systems/SpawnSystem';
import {
  objectsInLayer,
  hazardAffectsActor,
  pickupPlacements,
  property,
  spawnPoints as readSpawnPoints,
  validateMapData,
  type PickupPlacement,
  type TiledMapData,
  type TiledObject,
} from '../systems/MapSystem';
import { canFire, completeReload } from '../systems/WeaponSystem';
import { AmbienceSystem } from '../systems/AmbienceSystem';
import {
  GRAPHICS_PROFILES,
  mapWeather,
  resolveGraphicsQuality,
  type GraphicsProfile,
} from '../systems/GraphicsSystem';
import {
  advanceMode,
  completeSurvivalWave,
  createModeRuntime,
  currentLadderWeapon,
  finishTraining,
  registerElimination,
  type ModeRuntime,
} from '../systems/MatchModeSystem';
import { equipPickedWeapon } from '../systems/WeaponInventorySystem';
import { HudController } from '../ui/HudController';

export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const SCORE_LIMIT = 12;
export const MATCH_SECONDS = 180;

const SPAWNS: SpawnPoint[] = [
  { id: 'west-low', x: 145, y: 570 },
  { id: 'east-low', x: 1135, y: 570 },
  { id: 'west-high', x: 375, y: 305 },
  { id: 'east-high', x: 920, y: 295 },
  { id: 'center-low', x: 640, y: 480 },
  { id: 'center-high', x: 638, y: 170 },
];

const BOT_DATA: Array<{
  name: string;
  texture: string;
  weaponId: WeaponId;
  accuracy: number;
}> = [
  { name: 'VEX', texture: 'raider-coral', weaponId: 'ak47', accuracy: 0.12 },
  { name: 'ROOK', texture: 'raider-gold', weaponId: 'ironclad', accuracy: 0.17 },
  { name: 'NYX', texture: 'raider-green', weaponId: 'arc', accuracy: 0.08 },
  { name: 'BRICK', texture: 'raider-violet', weaponId: 'b4rpd', accuracy: 0.2 },
  { name: 'ECHO', texture: 'raider-green', weaponId: 'longbow', accuracy: 0.14 },
];

interface KeyMap {
  left: Phaser.Input.Keyboard.Key;
  leftAlt: Phaser.Input.Keyboard.Key;
  leftLetter: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  rightAlt: Phaser.Input.Keyboard.Key;
  rightLetter: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  upAlt: Phaser.Input.Keyboard.Key;
  upLetter: Phaser.Input.Keyboard.Key;
  jet: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  downAlt: Phaser.Input.Keyboard.Key;
  downLetter: Phaser.Input.Keyboard.Key;
  reload: Phaser.Input.Keyboard.Key;
  grenade: Phaser.Input.Keyboard.Key;
  one: Phaser.Input.Keyboard.Key;
  two: Phaser.Input.Keyboard.Key;
  pickup: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
  pause: Phaser.Input.Keyboard.Key;
}

const DEFAULT_BINDINGS: KeyBindings = {
  left: 'A',
  right: 'D',
  jet: 'W',
  down: 'S',
  reload: 'R',
  grenade: 'G',
  pause: 'ESC',
};

type GrenadeSprite = Phaser.Physics.Arcade.Sprite & { owner: ActorSprite };
type PickupSprite = Phaser.Physics.Arcade.Sprite & {
  pickupId: PickupId;
  baseY: number;
  outline?: Phaser.GameObjects.Arc;
  label?: Phaser.GameObjects.Text;
  expiresAt: number;
};

type SupplyDropType = 'weapon' | 'health' | 'armor' | 'fuel';

const activeArenaRef: { current: ArenaScene | null } = { current: null };
let nextProjectileId = 1;
let nextPickupId = 1;

export function getActiveArena(): ArenaScene | null {
  return activeArenaRef.current;
}

export class ArenaScene extends Phaser.Scene {
  private readonly ui = new HudController();
  private readonly touch = new TouchInput(
    document.querySelector<HTMLElement>('#move-pad')!,
    document.querySelector<HTMLElement>('#aim-pad')!,
    document.querySelector<HTMLElement>('#grenade-button')!,
  );
  private readonly eventsBus = new EventBus<GameEventMap>();
  private readonly fixedStep = new FixedStepRunner();
  private matchState = new MatchStateMachine();
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private actors!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private grenades!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.StaticGroup;
  private movingPlatforms!: Phaser.Physics.Arcade.Group;
  private hazards!: Phaser.Physics.Arcade.StaticGroup;
  private bots: ActorSprite[] = [];
  private player!: ActorSprite;
  private keys!: KeyMap;
  private crosshair!: Phaser.GameObjects.Graphics;
  private jetEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private burstEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private playerScore = 0;
  private enemyScore = 0;
  private timeLeft = MATCH_SECONDS;
  private lastSecond = MATCH_SECONDS;
  private matchEnded = false;
  private difficulty: DifficultyDefinition = DIFFICULTIES.recruit;
  private smokeZones: SmokeZone[] = [];
  private obstacleCache: RectangleObstacle[] = [];
  private navigation = new NavigationGraph([]);
  private currentMap!: MapDefinition;
  private currentMode: ModeDefinition = MODES['quick-deathmatch'];
  private modeRuntime: ModeRuntime = createModeRuntime('quick-deathmatch');
  private controlZone?: Phaser.GameObjects.Arc;
  private trainingShots = 0;
  private trainingHits = 0;
  private trainingDamage = 0;
  private matchStartedAt = 0;
  private survivalWavePending = false;
  private selectedPerk: PerkId | null = null;
  private graphicsProfile: GraphicsProfile = GRAPHICS_PROFILES.medium;
  private reducedMotion = false;
  private cameraShake = 1;
  private readonly ambience = new AmbienceSystem();
  private keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };
  private gamepadDeadzone = 0.18;
  private gamepadSensitivity = 1;
  private gamepadPauseHeld = false;
  private gamepadSwitchHeld = false;
  private gamepadPickupHeld = false;
  private colorVision: ColorVisionMode = 'default';
  private masterVolume = 0.8;
  private musicVolume = 0.65;
  private effectsVolume = 0.8;
  private ambienceVolume = 0.65;
  private uiVolume = 0.8;
  private highContrastPickups = true;
  private activeAudioVoices = 0;
  private mapData!: TiledMapData;
  private mapSpawns: SpawnPoint[] = SPAWNS;
  private supplyDropPoints: PickupPlacement[] = [];
  private supplyDropTimer?: Phaser.Time.TimerEvent;
  private supplyRandom = new SeededRandom(0x51f1);
  private nextWeaponDropAt = 0;
  private lastSupplyPoint = -1;
  private nearbyWeaponPickup?: PickupSprite;
  private readonly scaleResizeHandler = (gameSize: Phaser.Structs.Size): void => {
    this.updateCameraZoom(gameSize.width, gameSize.height);
  };
  private readonly blurHandler = (): void => {
    if (this.matchState.state === 'playing') this.setPaused(true);
  };

  constructor() {
    super('arena');
  }

  preload(): void {
    ['platform', 'medkit', 'fuel', 'weapon-crate'].forEach((key) =>
      this.load.image(key, assetPath(`/assets/${key}.png`)),
    );
    ['ranger', 'raider-coral', 'raider-gold', 'raider-green', 'raider-violet'].forEach((key) =>
      this.load.spritesheet(key, assetPath(`/assets/${key}-sheet.png`), {
        frameWidth: 96,
        frameHeight: 96,
      }),
    );
    WEAPON_IDS.forEach((weaponId) =>
      this.load.image(
        WEAPONS[weaponId].spriteKey,
        assetPath(`/assets/${WEAPONS[weaponId].spriteKey}.png`),
      ),
    );
    MAP_IDS.forEach((mapId) => {
      this.cache.json.add(MAPS[mapId].tilemapKey, bundledMaps[`/public/assets/maps/${mapId}.json`]);
      this.load.image(`background-${mapId}`, assetPath(`/assets/maps/${mapId}-background.jpg`));
    });
  }

  create(): void {
    activeArenaRef.current = this;
    reportReady(true);
    this.matchState = new MatchStateMachine();
    this.matchEnded = false;
    this.timeLeft = MATCH_SECONDS;
    this.playerScore = 0;
    this.enemyScore = 0;
    this.lastSecond = MATCH_SECONDS;
    this.smokeZones = [];
    this.fixedStep.reset();
    this.currentMap = MAPS[getSelectedMap()];
    this.currentMode = MODES[getSelectedMode()];
    this.modeRuntime = createModeRuntime(this.currentMode.id);
    this.timeLeft = this.currentMode.durationSeconds ?? 0;
    this.trainingShots = 0;
    this.trainingHits = 0;
    this.trainingDamage = 0;
    this.survivalWavePending = false;
    const visualSettings = getSaveRepository().load().settings;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const quality = resolveGraphicsQuality(visualSettings.graphicsQuality, {
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: memory,
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    });
    this.graphicsProfile = GRAPHICS_PROFILES[quality];
    this.reducedMotion =
      visualSettings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cameraShake = visualSettings.cameraShake;
    this.keyBindings = { ...visualSettings.keyBindings };
    this.gamepadDeadzone = visualSettings.gamepadDeadzone;
    this.gamepadSensitivity = visualSettings.gamepadSensitivity;
    this.colorVision = visualSettings.colorVision;
    this.masterVolume = visualSettings.masterVolume;
    this.musicVolume = visualSettings.musicVolume;
    this.effectsVolume = visualSettings.effectsVolume;
    this.ambienceVolume = visualSettings.ambienceVolume;
    this.uiVolume = visualSettings.uiVolume;
    this.highContrastPickups = visualSettings.highContrastPickups;
    this.touch.setAimSensitivity(visualSettings.touchAimSensitivity);
    this.mapData = this.cache.json.get(this.currentMap.tilemapKey) as TiledMapData;
    const mapErrors = validateMapData(this.mapData);
    if (mapErrors.length > 0)
      throw new Error(`${this.currentMap.displayName}: ${mapErrors.join('; ')}`);
    this.mapSpawns = readSpawnPoints(this.mapData);
    const dropSeed = [...this.currentMap.id].reduce(
      (total, character) => total * 31 + character.charCodeAt(0),
      0x51f1,
    );
    this.supplyRandom = new SeededRandom(dropSeed);
    this.lastSupplyPoint = -1;
    this.supplyDropTimer = undefined;

    this.createTextures();
    this.createActorAnimations();
    this.createArena();
    this.createGroups();
    this.createActors();
    this.createPickups();
    this.createInput();
    this.createCrosshair();
    this.createEffects();
    this.bindPhysics();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.scaleResizeHandler);

    this.physics.pause();
    this.cameras.main.fadeIn(500, 5, 18, 24);
    this.ui.showMenu();
    this.updateHud();
    window.addEventListener('blur', this.blurHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', this.blurHandler);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.scaleResizeHandler);
      this.eventsBus.clear();
      this.ambience.stop();
      if (activeArenaRef.current === this) activeArenaRef.current = null;
    });
    if (this.registry.get('autostartMatch')) {
      this.registry.remove('autostartMatch');
      this.time.delayedCall(0, () => this.startMatch());
    }
  }

  startMatch(): void {
    if (this.matchState.state !== 'menu' || this.matchEnded) return;
    if (this.currentMap.id !== getSelectedMap() || this.currentMode.id !== getSelectedMode()) {
      this.registry.set('autostartMatch', true);
      this.scene.restart();
      return;
    }
    const loadout = getLoadout();
    this.difficulty = DIFFICULTIES[getDifficulty()];
    this.selectedPerk = getSaveRepository().load().settings.selectedPerk;
    this.player.weaponSlots = ['m9'];
    this.player.grenadeId = loadout.grenade;
    this.player.grenades = GRENADES[loadout.grenade].maximumCarried;
    this.switchWeapon(this.player, 'm9');
    this.bots.forEach((bot, index) => {
      bot.health = Math.round(100 * this.difficulty.botHealthMultiplier);
      bot.teamId =
        this.currentMode.id === 'team-deathmatch' || this.currentMode.id === 'control-point'
          ? index < 2
            ? 'ranger'
            : 'raiders'
          : 'raiders';
      bot.nameTag.setColor(this.teamColor(bot.teamId));
    });
    this.matchState.transition('playing');
    this.physics.resume();
    this.ui.showMatch();
    this.cameras.main.flash(230, 93, 226, 202, false);
    this.announce('MATCH LIVE', 0x74e4cf);
    this.ambience.start(
      MAP_AMBIENCE[this.currentMap.id],
      this.masterVolume * this.ambienceVolume,
      this.masterVolume * this.musicVolume,
    );
    this.matchStartedAt = this.time.now;
    this.nextWeaponDropAt =
      this.time.now + this.supplyRandom.between(...this.difficulty.weaponDropCooldownMs);
    this.scheduleNextSupplyDrop(this.supplyRandom.between(3500, 6000));
    this.setupModeObjective();
    this.ui.setTrainingSession(this.currentMode.id === 'training-range');
    this.eventsBus.emit('match:started', { at: this.time.now });
    this.updateHud();
    if (new URLSearchParams(window.location.search).has('e2e-fast')) {
      this.time.delayedCall(250, () => this.endMatch(true));
    }
  }

  finishTrainingSession(): void {
    if (this.matchState.state !== 'playing' || this.currentMode.id !== 'training-range') return;
    finishTraining(this.modeRuntime);
    this.endMatch(true);
  }

  restartMatch(): void {
    this.ui.result.classList.add('hidden');
    this.ui.feed.replaceChildren();
    this.scene.restart();
    window.setTimeout(() => getActiveArena()?.startMatch(), 100);
  }

  togglePause(): void {
    if (this.matchState.state === 'playing') this.setPaused(true);
    else if (this.matchState.state === 'paused') this.setPaused(false);
  }

  pauseForOrientation(): void {
    this.touch.reset();
    this.input.keyboard?.resetKeys();
    if (this.matchState.state === 'playing') this.setPaused(true);
  }

  exitToLobby(): void {
    if (
      this.matchState.state !== 'playing' &&
      this.matchState.state !== 'paused' &&
      !this.matchEnded
    )
      return;
    this.registry.remove('autostartMatch');
    this.matchEnded = true;
    this.time.paused = false;
    this.physics.resume();
    this.ambience.stop();
    this.jetEmitter.emitting = false;
    this.supplyDropTimer?.remove(false);
    this.ui.feed.replaceChildren();
    this.ui.showMenu();
    this.scene.restart();
    window.dispatchEvent(new Event('flashfire:navigate-lobby'));
  }

  selectWeaponSlot(index: number): void {
    const weaponId = this.player?.weaponSlots[index];
    if (weaponId) this.switchWeapon(this.player, weaponId);
  }

  pickupNearbyWeapon(): void {
    const item = this.nearbyWeaponPickup;
    if (!item?.active || this.matchState.state !== 'playing' || !this.player?.alive) return;
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, item.x, item.y) > 96) return;
    this.collectPickup(this.player, item, true);
    this.nearbyWeaponPickup = undefined;
    this.ui.hideWeaponPickup();
  }

  update(time: number, delta: number): void {
    this.updateGamepadPause();
    this.updateCrosshair();
    this.animatePickups(time);
    if (this.matchState.state !== 'playing') return;
    this.fixedStep.advance(delta, (stepMs) => this.simulate(time, stepMs / 1000));
    this.updateWeaponPickupPrompt();
    this.updateActorsVisuals();
    this.updateProjectiles(time);
    this.updateHud();
  }

  private simulate(time: number, dt: number): void {
    this.smokeZones = this.smokeZones.filter((zone) => zone.expiresAt > time);
    advanceMode(this.modeRuntime, dt, this.controlPointOwner());
    this.playerScore = Math.floor(this.modeRuntime.rangerScore);
    this.enemyScore = Math.floor(this.modeRuntime.raiderScore);
    this.timeLeft = this.modeRuntime.timeLeft;
    this.updateControlZone();
    [this.player, ...this.bots].forEach((actor) => {
      if (actor && ((actor.getData('iceUntil') as number | undefined) ?? 0) < time)
        actor.setDragX(900);
    });
    if (Math.ceil(this.timeLeft) !== this.lastSecond) {
      this.lastSecond = Math.ceil(this.timeLeft);
      this.updateHud();
    }
    if (this.modeRuntime.finished) {
      this.endMatch(this.modeRuntime.victory);
      return;
    }
    this.updatePlayer(time, dt);
    this.bots.forEach((bot) => this.updateBot(bot, time, dt));
  }

  private setPaused(paused: boolean): void {
    if (paused && this.matchState.state === 'playing') {
      this.touch.reset();
      this.input.keyboard?.resetKeys();
      this.matchState.transition('paused');
      this.physics.pause();
      this.time.paused = true;
    } else if (!paused && this.matchState.state === 'paused') {
      this.matchState.transition('playing');
      this.time.paused = false;
      this.physics.resume();
      this.fixedStep.reset();
    } else return;
    this.ui.showPause(paused);
    this.eventsBus.emit('match:paused', { paused });
  }

  private createTextures(): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 1).fillCircle(7, 7, 7);
    graphics.generateTexture('particle', 14, 14);
    graphics.clear().fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 22, 8, 4);
    graphics.generateTexture('bullet', 22, 8);
    graphics.clear().fillStyle(0x697b76, 1).fillCircle(11, 11, 11);
    graphics.lineStyle(3, 0x263631, 1).strokeCircle(11, 11, 10);
    graphics.generateTexture('grenade', 22, 22);
    graphics.clear().fillStyle(0x17343a, 1).fillRoundedRect(0, 0, 64, 36, 7);
    graphics.lineStyle(2, 0x5c9389, 1).strokeRoundedRect(0, 0, 64, 36, 7);
    graphics.generateTexture('spawn-pad', 64, 36);
    graphics.clear().fillStyle(0xffffff, 1).fillRect(0, 0, 8, 8);
    graphics.generateTexture('hazard-zone', 8, 8);
    graphics.clear().fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 3, 12, 1);
    graphics.generateTexture('weather-particle', 3, 12);
    graphics.destroy();
  }

  private createActorAnimations(): void {
    ['ranger', 'raider-coral', 'raider-gold', 'raider-green', 'raider-violet'].forEach(
      (texture) => {
        const key = `${texture}-move`;
        if (this.anims.exists(key)) return;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(texture, { start: 0, end: 5 }),
          frameRate: 10,
          repeat: -1,
        });
      },
    );
  }

  private createArena(): void {
    const { width, height } = this.currentMap.worldBounds;
    this.physics.world.setBounds(0, 0, width, height);
    this.physics.world.gravity.y = this.currentMap.id === 'sky-fortress' ? 520 : 860;
    this.cameras.main.setBounds(0, 0, width, height);
    this.updateCameraZoom(this.scale.gameSize.width, this.scale.gameSize.height);
    this.add
      .image(width / 2, height / 2, `background-${this.currentMap.id}`)
      .setDisplaySize(width, height)
      .setDepth(-10);
    const haze = this.add.graphics();
    haze.fillGradientStyle(
      0x07141b,
      0x07141b,
      this.currentMap.palette.haze,
      this.currentMap.palette.haze,
      0.04,
      0.04,
      0.24,
      0.24,
    );
    haze.fillRect(0, 0, width, height);
    const lightingColor =
      this.currentMap.id === 'ember-foundry'
        ? 0xff6238
        : this.currentMap.id === 'drydock-12'
          ? 0x6ea8c5
          : this.currentMap.id === 'canopy-ruins'
            ? 0x5dcc91
            : this.currentMap.id === 'frost-relay'
              ? 0xbceeff
              : this.currentMap.id === 'neon-underpass'
                ? 0xe958d0
                : this.currentMap.id === 'sky-fortress'
                  ? 0xd9efff
                  : this.currentMap.id === 'blacksite-zero'
                    ? 0xe84945
                    : 0xe9b657;
    this.add
      .rectangle(
        width / 2,
        height / 2,
        width,
        height,
        lightingColor,
        this.graphicsProfile.lightingAlpha,
      )
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(4);
    if (this.currentMap.id === 'drydock-12') {
      this.add.rectangle(width / 2, height - 105, width, 210, 0x173f58, 0.38).setDepth(3);
      for (let x = 0; x < width; x += 90) {
        this.add.rectangle(x, height - 125 + ((x / 90) % 2) * 18, 58, 3, 0xd3ad59, 0.2).setDepth(4);
      }
    }
    this.platforms = this.physics.add.staticGroup();
    this.movingPlatforms = this.physics.add.group({ allowGravity: false, immovable: true });
    this.hazards = this.physics.add.staticGroup();
    objectsInLayer(this.mapData, 'collision').forEach((object) => {
      this.addPlatform(
        object.x + (object.width ?? 0) / 2,
        object.y + (object.height ?? 44) / 2,
        object.width ?? 200,
        object.height ?? 44,
      );
    });
    objectsInLayer(this.mapData, 'one_way_platforms').forEach((object) =>
      this.addMapPlatform(object),
    );
    objectsInLayer(this.mapData, 'hazards').forEach((object) => this.addHazard(object));
    this.mapSpawns
      .slice(0, 2)
      .forEach((spawn) => this.add.image(spawn.x, spawn.y + 44, 'spawn-pad').setAlpha(0.72));
    this.add
      .text(36, 34, this.currentMap.displayName, {
        fontFamily: 'Barlow Condensed',
        fontSize: '18px',
        fontStyle: 'bold',
        color: this.currentMap.palette.accent,
        stroke: '#061117',
        strokeThickness: 4,
      })
      .setDepth(8);
    const navigationObjects = objectsInLayer(this.mapData, 'navigation_nodes');
    const navigationNodes = navigationObjects.map((object) => ({
      id: object.name ?? `node-${object.id}`,
      x: object.x,
      y: object.y,
      neighbors: navigationObjects
        .filter((candidate) => candidate !== object)
        .sort(
          (left, right) =>
            Math.hypot(left.x - object.x, left.y - object.y) -
            Math.hypot(right.x - object.x, right.y - object.y),
        )
        .slice(0, 3)
        .map((candidate) => candidate.name ?? `node-${candidate.id}`),
    }));
    this.navigation = new NavigationGraph(navigationNodes);
    this.obstacleCache = this.platforms.getChildren().map((child) => {
      const body = (child as Phaser.Physics.Arcade.Image).body as Phaser.Physics.Arcade.StaticBody;
      return {
        left: body.x,
        right: body.x + body.width,
        top: body.y,
        bottom: body.y + body.height,
      };
    });
    const foreground = this.add.graphics().setDepth(70);
    foreground.fillStyle(0x061216, 0.72);
    for (let x = 0; x < width; x += 37) {
      const grassHeight = 12 + ((x * 17) % 38);
      foreground.fillTriangle(x, height, x + 13, height - grassHeight, x + 25, height);
    }
  }

  private addPlatform(
    x: number,
    y: number,
    width: number,
    height = 44,
  ): Phaser.Physics.Arcade.Image {
    const platform = this.platforms.create(x, y, 'platform') as Phaser.Physics.Arcade.Image;
    platform.setDisplaySize(width, height).refreshBody().setDepth(5);
    return platform;
  }

  private addMapPlatform(object: TiledObject): void {
    const width = object.width ?? 200;
    const height = object.height ?? 44;
    if (object.type === 'moving') {
      const platform = this.movingPlatforms.create(
        object.x + width / 2,
        object.y + height / 2,
        'platform',
      ) as Phaser.Physics.Arcade.Image;
      platform.setDisplaySize(width, height).setImmovable(true).setDepth(6);
      (platform.body as Phaser.Physics.Arcade.Body).setAllowGravity(false).setSize(width, height);
      this.tweens.add({
        targets: platform,
        x: platform.x + property(object, 'travelX', 0),
        y: platform.y + property(object, 'travelY', 0),
        duration: property(object, 'duration', 3000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
      return;
    }
    const platform = this.addPlatform(object.x + width / 2, object.y + height / 2, width, height);
    if (object.type === 'service-door') {
      platform.setTint(0x9e4ae8);
      this.time.addEvent({
        delay: 6000,
        loop: true,
        callback: () => {
          if (platform.body?.enable) platform.disableBody(true, true);
          else platform.enableBody(false, platform.x, platform.y, true, true);
        },
      });
    }
    if (property(object, 'breakable', false)) {
      this.time.addEvent({
        delay: 18000,
        loop: true,
        callback: () => {
          this.tweens.add({
            targets: platform,
            alpha: 0.25,
            duration: 900,
            onComplete: () => {
              platform.disableBody(true, true);
              this.time.delayedCall(4500, () =>
                platform.enableBody(false, platform.x, platform.y, true, true).setAlpha(1),
              );
            },
          });
        },
      });
    }
  }

  private addHazard(object: TiledObject): void {
    const width = object.width ?? 100;
    const height = object.height ?? 80;
    const hazard = this.hazards.create(
      object.x + width / 2,
      object.y + height / 2,
      'hazard-zone',
    ) as Phaser.Physics.Arcade.Image;
    hazard
      .setDisplaySize(width, height)
      .refreshBody()
      .setData('hazardType', object.type ?? 'kill')
      .setData('speed', property(object, 'speed', 0));
    if (object.type === 'train') {
      hazard.setTint(0xff4fc8).setAlpha(0.72).setDepth(7);
      this.tweens.add({
        targets: hazard,
        x: this.currentMap.worldBounds.width + width,
        duration: Math.round(
          ((this.currentMap.worldBounds.width + width * 2) /
            Math.max(1, property(object, 'speed', 550))) *
            1000,
        ),
        repeat: -1,
        repeatDelay: 4200,
        onUpdate: () => hazard.refreshBody(),
      });
      return;
    }
    if (object.type === 'laser') {
      hazard.setTint(0xff3434).setAlpha(0.75).setDepth(7);
      this.time.addEvent({
        delay: 3500,
        loop: true,
        callback: () => {
          if (hazard.body?.enable) hazard.disableBody(false, false).setAlpha(0.08);
          else hazard.enableBody(false, hazard.x, hazard.y, true, true).setAlpha(0.75);
        },
      });
      return;
    }
    hazard
      .setTint(
        object.type === 'vent'
          ? 0xff704d
          : object.type === 'conveyor'
            ? 0xf2c15a
            : object.type === 'ice'
              ? 0xc6f4ff
              : object.type === 'wind'
                ? 0xe5f6ff
                : 0x3d7892,
      )
      .setAlpha(0.2)
      .setDepth(4);
  }

  private createGroups(): void {
    this.actors = this.physics.add.group();
    this.bullets = this.physics.add.group({ maxSize: 180, allowGravity: false });
    this.bullets.createMultiple({ key: 'bullet', quantity: 80, active: false, visible: false });
    this.grenades = this.physics.add.group();
    this.pickups = this.physics.add.staticGroup();
    this.bots = [];
  }

  private createActors(): void {
    const playerSpawn = this.mapSpawns[0];
    this.player = this.spawnActor('RANGER', 'ranger', playerSpawn.x, playerSpawn.y, true, 'm9');
    BOT_DATA.forEach((data, index) => {
      const spawn = this.mapSpawns[(index + 1) % this.mapSpawns.length];
      const bot = this.spawnActor(data.name, data.texture, spawn.x, spawn.y, false, data.weaponId);
      bot.accuracy = data.accuracy;
      bot.nextDecisionAt = 0;
      bot.moveDirection = index % 2 ? -1 : 1;
      bot.jumpBias = 0.34 + index * 0.08;
      this.bots.push(bot);
    });
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(180, 110);
    this.cameras.main.centerOn(this.player.x, this.player.y);
  }

  private updateCameraZoom(viewportWidth: number, viewportHeight: number): void {
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    const { width: mapWidth, height: mapHeight } = this.currentMap.worldBounds;
    const designZoom = Math.min(viewportWidth / WORLD_WIDTH, viewportHeight / WORLD_HEIGHT);
    const mapBoundsZoom = Math.max(viewportWidth / mapWidth, viewportHeight / mapHeight);
    this.cameras.main.setZoom(Math.max(designZoom, mapBoundsZoom));
  }

  private spawnActor(
    name: string,
    texture: string,
    x: number,
    y: number,
    isPlayer: boolean,
    weaponId: WeaponId,
  ): ActorSprite {
    const actor = this.actors.create(x, y, texture) as ActorSprite;
    actor
      .setScale(0.72)
      .setDepth(30)
      .setCollideWorldBounds(true)
      .setDragX(900)
      .setMaxVelocity(360, 520);
    (actor.body as Phaser.Physics.Arcade.Body).setSize(45, 76).setOffset(25, 14);
    actor.id = actorId();
    actor.teamId = isPlayer ? 'ranger' : 'raiders';
    actor.actorName = name;
    actor.isPlayer = isPlayer;
    actor.alive = true;
    actor.health = 100;
    actor.armor = 0;
    actor.fuel = 100;
    actor.weaponId = weaponId;
    actor.weaponSlots = [weaponId];
    actor.ammo = createInventory(isPlayer);
    actor.lastShotAt = -Infinity;
    actor.reloadToken = 0;
    actor.reloading = false;
    actor.grenadeReadyAt = 0;
    actor.grenadeId = 'frag';
    actor.grenades = GRENADES.frag.maximumCarried;
    actor.aimAngle = 0;
    actor.shotHeat = 0;
    actor.jetActive = false;
    actor.accuracy = 0;
    actor.nextDecisionAt = 0;
    actor.moveDirection = 0;
    actor.jumpBias = 0;
    actor.behavior = 'patrol';
    actor.lastSeenAt = -Infinity;
    actor.lastKnownTargetX = x;
    actor.lastKnownTargetY = y;
    actor.reactionReadyAt = 0;
    const seed = [...name].reduce((total, character) => total + character.charCodeAt(0), 37);
    actor.random = new SeededRandom(seed);
    if (!isPlayer && new URLSearchParams(window.location.search).has('debug-ai')) {
      actor.debugTag = this.add
        .text(x, y + 48, 'PATROL', {
          fontFamily: 'Inter',
          fontSize: '9px',
          color: '#7ce2cf',
          backgroundColor: '#06151dcc',
        })
        .setOrigin(0.5)
        .setDepth(41);
    }
    actor.nameTag = this.add
      .text(x, y - 57, name, {
        fontFamily: 'Inter',
        fontSize: '11px',
        fontStyle: 'bold',
        color: this.teamColor(isPlayer ? 'ranger' : 'raiders'),
        stroke: '#061117',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(40);
    actor.gun = this.add.image(x, y, WEAPONS[weaponId].spriteKey).setScale(0.62).setDepth(35);
    return actor;
  }

  private createPickups(): void {
    this.supplyDropPoints = pickupPlacements(this.mapData);
    if (this.supplyDropPoints.length === 0) {
      this.supplyDropPoints = this.mapSpawns.map((spawn) => ({
        x: spawn.x,
        y: spawn.y,
        type: 'health',
      }));
    }
  }

  private scheduleNextSupplyDrop(delayMs = this.supplyRandom.between(10_000, 17_000)): void {
    this.supplyDropTimer?.remove(false);
    this.supplyDropTimer = this.time.delayedCall(delayMs, () => {
      if (this.matchState.state !== 'playing') return;
      this.spawnSupplyDrop();
      this.scheduleNextSupplyDrop();
    });
  }

  private spawnSupplyDrop(forcedType?: SupplyDropType, forcedWeaponId?: WeaponId): PickupSprite {
    const weightedTypes: SupplyDropType[] =
      this.time.now >= this.nextWeaponDropAt
        ? ['weapon', 'health', 'armor', 'fuel', 'weapon']
        : ['health', 'armor', 'fuel'];
    const type =
      forcedType ?? weightedTypes[Math.floor(this.supplyRandom.next() * weightedTypes.length)];
    if (type === 'weapon')
      this.nextWeaponDropAt =
        this.time.now + this.supplyRandom.between(...this.difficulty.weaponDropCooldownMs);
    let pointIndex = Math.floor(this.supplyRandom.next() * this.supplyDropPoints.length);
    if (pointIndex === this.lastSupplyPoint && this.supplyDropPoints.length > 1)
      pointIndex = (pointIndex + 1) % this.supplyDropPoints.length;
    this.lastSupplyPoint = pointIndex;
    const point = this.supplyDropPoints[pointIndex];
    const availableWeapons = WEAPON_IDS.filter((weaponId) => weaponId !== 'm9');
    const weaponId =
      type === 'weapon'
        ? (forcedWeaponId ??
          availableWeapons[Math.floor(this.supplyRandom.next() * availableWeapons.length)])
        : undefined;
    const texture =
      type === 'fuel'
        ? 'fuel'
        : type === 'weapon' && weaponId
          ? WEAPONS[weaponId].spriteKey
          : type === 'weapon'
            ? 'weapon-crate'
            : 'medkit';
    const item = this.addPickup(point.x, point.y, texture, type, weaponId, 18_000);
    const label = weaponId ? WEAPONS[weaponId].displayName : type.toUpperCase();
    this.announce(`SUPPLY DROP: ${label}`, weaponId ? WEAPONS[weaponId].color : 0x74e4cf);
    return item;
  }

  private addPickup(
    x: number,
    y: number,
    texture: string,
    type: SupplyDropType,
    value?: WeaponId,
    lifetimeMs = 18_000,
    blockedActorId?: ActorSprite['id'],
  ): PickupSprite {
    const resolvedTexture = type === 'weapon' && value ? WEAPONS[value].spriteKey : texture;
    const item = this.pickups.create(x, y, resolvedTexture) as PickupSprite;
    item
      .setScale(type === 'weapon' ? 1.08 : 0.68)
      .refreshBody()
      .setDepth(20)
      .setData({
        type,
        value,
        blockedActorId,
        pickupReadyAt: blockedActorId ? this.time.now + 1400 : this.time.now,
      });
    item.pickupId = `pickup-${nextPickupId++}` as PickupId;
    item.baseY = y;
    item.expiresAt = this.time.now + lifetimeMs;
    if (type === 'weapon' && value) {
      const weapon = WEAPONS[value];
      item.label = this.add
        .text(x, y - 34, weapon.displayName, {
          fontFamily: 'Inter',
          fontSize: '9px',
          fontStyle: 'bold',
          color: `#${weapon.color.toString(16).padStart(6, '0')}`,
          backgroundColor: '#061117',
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5)
        .setDepth(22);
    }
    if (this.highContrastPickups) {
      item.outline = this.add
        .circle(x, y, 30, 0x000000, 0)
        .setStrokeStyle(3, 0xffffff, 0.9)
        .setDepth(19);
    }
    this.tweens.add({
      targets: item.outline ? [item, item.outline] : item,
      y: y - 8,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.time.delayedCall(lifetimeMs, () => {
      if (item.active) this.removePickup(item);
    });
    return item;
  }

  private removePickup(item: PickupSprite): void {
    item.outline?.destroy();
    item.label?.destroy();
    if (this.nearbyWeaponPickup === item) {
      this.nearbyWeaponPickup = undefined;
      this.ui.hideWeaponPickup();
    }
    item.destroy();
  }

  private createInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input is unavailable');
    this.keys = keyboard.addKeys({
      left: toPhaserKeyName(this.keyBindings.left),
      leftAlt: 'LEFT',
      leftLetter: 'A',
      right: toPhaserKeyName(this.keyBindings.right),
      rightAlt: 'RIGHT',
      rightLetter: 'D',
      up: toPhaserKeyName(this.keyBindings.jet),
      upAlt: 'UP',
      upLetter: 'W',
      jet: 'SPACE',
      down: toPhaserKeyName(this.keyBindings.down),
      downAlt: 'DOWN',
      downLetter: 'S',
      reload: toPhaserKeyName(this.keyBindings.reload),
      grenade: toPhaserKeyName(this.keyBindings.grenade),
      one: 'ONE',
      two: 'TWO',
      pickup: 'E',
      enter: 'ENTER',
      pause: toPhaserKeyName(this.keyBindings.pause),
    }) as KeyMap;
    this.keys.reload.on('down', () => this.startReload(this.player));
    this.keys.grenade.on('down', () => this.throwGrenade(this.player));
    this.keys.one.on('down', () => this.selectWeaponSlot(0));
    this.keys.two.on('down', () => this.selectWeaponSlot(1));
    this.keys.pickup.on('down', () => this.pickupNearbyWeapon());
    this.keys.enter.on('down', () => this.startMatch());
    this.keys.pause.on('down', () => this.togglePause());
    this.input.mouse?.disableContextMenu();
  }

  private createCrosshair(): void {
    this.crosshair = this.add.graphics().setDepth(100);
    this.crosshair.lineStyle(2, 0xf1c25a, 0.9).strokeCircle(0, 0, 12);
    this.crosshair.lineBetween(-19, 0, -8, 0).lineBetween(8, 0, 19, 0);
    this.crosshair.lineBetween(0, -19, 0, -8).lineBetween(0, 8, 0, 19);
  }

  private createEffects(): void {
    this.jetEmitter = this.add
      .particles(0, 0, 'particle', {
        speed: { min: 50, max: 115 },
        angle: { min: 72, max: 108 },
        lifespan: { min: 160, max: 280 },
        scale: { start: 0.45, end: 0 },
        tint: [0x4fe0c7, 0xf1c25a, 0xef6e55],
        frequency: 28,
        emitting: false,
      })
      .setDepth(25);
    this.burstEmitter = this.add
      .particles(0, 0, 'particle', {
        speed: { min: 35, max: 220 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 170, max: 420 },
        scale: { start: 0.42, end: 0 },
        tint: 0xf2bd55,
        emitting: false,
      })
      .setDepth(62);
    const weather = mapWeather(this.currentMap.id);
    this.add
      .particles(0, 0, 'weather-particle', {
        x: { min: 0, max: this.currentMap.worldBounds.width },
        y: { min: -20, max: this.currentMap.worldBounds.height },
        speed: { min: weather.speed * 0.72, max: weather.speed },
        angle: { min: weather.angle - 6, max: weather.angle + 6 },
        lifespan: { min: 1600, max: 3600 },
        alpha: { start: 0.42, end: 0 },
        scale: { min: 0.35, max: 0.85 },
        tint: weather.tint,
        frequency: this.graphicsProfile.weatherFrequency * (this.reducedMotion ? 2 : 1),
      })
      .setDepth(3);
  }

  private bindPhysics(): void {
    this.physics.add.collider(this.actors, this.platforms);
    this.physics.add.collider(this.actors, this.movingPlatforms);
    this.physics.add.collider(this.actors, this.actors);
    this.physics.add.collider(this.grenades, this.platforms, (grenadeObject) => {
      const grenade = grenadeObject as GrenadeSprite;
      if (grenade.getData('grenadeId') === 'sticky') {
        grenade.setVelocity(0, 0).setAngularVelocity(0);
        (grenade.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
      }
    });
    this.physics.add.collider(this.bullets, this.platforms, (bullet) =>
      this.impactProjectile(bullet as ProjectileSprite),
    );
    this.physics.add.overlap(this.bullets, this.actors, (bullet, actor) =>
      this.hitActor(bullet as ProjectileSprite, actor as ActorSprite),
    );
    this.physics.add.overlap(this.actors, this.pickups, (actor, item) =>
      this.collectPickup(actor as ActorSprite, item as PickupSprite),
    );
    this.physics.add.overlap(this.actors, this.hazards, (actor, hazard) =>
      this.applyHazard(actor as ActorSprite, hazard as Phaser.Physics.Arcade.Image),
    );
  }

  private updatePlayer(time: number, dt: number): void {
    const player = this.player;
    if (!player.alive) return;
    const touch = this.touch.snapshot();
    const pad = this.input.gamepad?.getPad(0);
    const leftAxis = applyGamepadDeadzone(pad?.axes[0]?.getValue() ?? 0, this.gamepadDeadzone);
    const rightX = pad?.axes[2]?.getValue() ?? 0;
    const rightY = pad?.axes[3]?.getValue() ?? 0;
    const gamepadAngle = gamepadAimAngle(rightX, rightY, this.gamepadDeadzone);
    const gamepadAiming = gamepadAngle !== null;
    const gamepadFiring = Boolean(pad?.buttons[7]?.pressed) || gamepadAiming;
    const weapon = WEAPONS[player.weaponId];
    player.shotHeat = Math.max(0, player.shotHeat - dt * 1.8);
    let direction =
      Number(this.keys.right.isDown || this.keys.rightAlt.isDown || this.keys.rightLetter.isDown) -
      Number(this.keys.left.isDown || this.keys.leftAlt.isDown || this.keys.leftLetter.isDown);
    if (Math.abs(touch.moveX) > 0.12) direction = touch.moveX;
    if (leftAxis !== 0) direction = leftAxis;
    player.setAccelerationX(direction * 1100);
    player.setMaxVelocity(
      360 * weapon.movementMultiplier * (this.selectedPerk === 'light-frame' ? 1.05 : 1),
      520,
    );
    const jetDisabled = ((player.getData('jetDisabledUntil') as number | undefined) ?? 0) > time;
    player.jetActive =
      !jetDisabled &&
      (this.keys.up.isDown ||
        this.keys.upAlt.isDown ||
        this.keys.upLetter.isDown ||
        this.keys.jet.isDown ||
        touch.wantsJet ||
        Boolean(pad?.buttons[6]?.pressed) ||
        (pad?.axes[1]?.getValue() ?? 0) < -this.gamepadDeadzone) &&
      player.fuel > 0;
    if (player.jetActive) {
      player.setAccelerationY(-1450);
      player.fuel = Math.max(0, player.fuel - 31 * dt);
    } else {
      const wantsDrop =
        this.keys.down.isDown ||
        this.keys.downAlt.isDown ||
        this.keys.downLetter.isDown ||
        touch.wantsDrop ||
        (pad?.axes[1]?.getValue() ?? 0) > this.gamepadDeadzone;
      player.setAccelerationY(wantsDrop ? 900 : 0);
      const grounded = (player.body as Phaser.Physics.Arcade.Body).blocked.down;
      const perkMultiplier = this.selectedPerk === 'fuel-recycler' ? 1.15 : 1;
      player.fuel = Math.min(100, player.fuel + (grounded ? 25 : 11) * dt * perkMultiplier);
    }
    player.aimAngle = touch.firing
      ? Math.atan2(touch.aimY, touch.aimX)
      : Phaser.Math.Angle.Between(
          player.x,
          player.y - 4,
          this.input.activePointer.worldX,
          this.input.activePointer.worldY,
        );
    if (gamepadAiming) {
      player.aimAngle = Phaser.Math.Angle.RotateTo(
        player.aimAngle,
        gamepadAngle ?? player.aimAngle,
        dt * 9 * this.gamepadSensitivity,
      );
    }
    const lead = this.reducedMotion ? 0 : this.graphicsProfile.cameraLead;
    this.cameras.main.setFollowOffset(
      -Math.cos(player.aimAngle) * lead,
      -Math.sin(player.aimAngle) * lead * 0.45,
    );
    const mouseFiring =
      this.input.activePointer.isDown &&
      !this.input.activePointer.wasTouch &&
      this.input.activePointer.button === 0;
    if (mouseFiring || touch.firing || gamepadFiring) this.fireWeapon(player, time);
    if (touch.grenade || pad?.buttons[4]?.pressed) this.throwGrenade(player);
    if (pad?.buttons[2]?.pressed) this.startReload(player);
    const switchPressed = Boolean(pad?.buttons[3]?.pressed);
    if (switchPressed && !this.gamepadSwitchHeld) {
      const currentSlot = player.weaponSlots.indexOf(player.weaponId);
      this.selectWeaponSlot(currentSlot === 0 ? 1 : 0);
    }
    this.gamepadSwitchHeld = switchPressed;
    const pickupPressed = Boolean(pad?.buttons[0]?.pressed);
    if (pickupPressed && !this.gamepadPickupHeld) this.pickupNearbyWeapon();
    this.gamepadPickupHeld = pickupPressed;
    this.jetEmitter.emitting = player.jetActive;
    this.jetEmitter.setPosition(player.x - Math.cos(player.aimAngle) * 7, player.y + 27);
  }

  private updateBot(bot: ActorSprite, time: number, dt: number): void {
    if (!bot.alive || this.currentMode.id === 'training-range') return;
    const target = [this.player, ...this.bots]
      .filter((actor) => actor !== bot && actor.alive && actor.teamId !== bot.teamId)
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(bot.x, bot.y, a.x, a.y) -
          Phaser.Math.Distance.Between(bot.x, bot.y, b.x, b.y),
      )[0];
    if (!target) return;
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const distance = Math.hypot(dx, dy);
    const body = bot.body as Phaser.Physics.Arcade.Body;
    const weapon = WEAPONS[bot.weaponId];
    const visible = hasLineOfSight(
      { x: bot.x, y: bot.y - 8 },
      { x: target.x, y: target.y - 8 },
      this.platformObstacles(),
      this.smokeZones,
      time,
    );
    const wasVisible = Boolean(bot.getData('targetVisible'));
    bot.setData('targetVisible', visible);
    if (visible) {
      if (!wasVisible) {
        bot.reactionReadyAt = time + reactionDelay(this.difficulty, bot.random.next());
        bot.setData(
          'aimOffset',
          Phaser.Math.DegToRad(this.difficulty.aimErrorDeg) * (bot.random.next() * 2 - 1),
        );
      }
      bot.lastSeenAt = time;
      bot.lastKnownTargetX = target.x;
      bot.lastKnownTargetY = target.y;
    }
    const remembersTarget = time - bot.lastSeenAt <= this.difficulty.memoryMs;
    bot.shotHeat = Math.max(0, bot.shotHeat - dt * 1.8);
    bot.setMaxVelocity(360 * weapon.movementMultiplier, 520);
    if (time > bot.nextDecisionAt) {
      bot.nextDecisionAt = time + reactionDelay(this.difficulty, bot.random.next());
      const hasNearbyHealth = this.pickups.getChildren().some((child) => {
        const pickup = child as PickupSprite;
        return (
          pickup.active &&
          pickup.getData('type') === 'health' &&
          Phaser.Math.Distance.Between(bot.x, bot.y, pickup.x, pickup.y) <
            this.difficulty.pickupAwarenessRadius
        );
      });
      bot.behavior = chooseBehavior(
        {
          health: bot.health,
          targetVisible: visible,
          targetDistance: distance,
          lastKnownTarget: remembersTarget
            ? { x: bot.lastKnownTargetX, y: bot.lastKnownTargetY }
            : null,
          hasNearbyHealth,
          underThreat: distance < 260,
        },
        this.difficulty,
        weapon,
      );
      if (bot.behavior === 'retreat' || bot.behavior === 'evade')
        bot.moveDirection = -Math.sign(dx);
      else if (bot.behavior === 'engage')
        bot.moveDirection = Math.abs(dx) > 180 ? Math.sign(dx) : 0;
      else if (bot.behavior === 'reposition') {
        const preferred =
          weapon.category === 'shotgun' || weapon.category === 'smg'
            ? 220
            : weapon.category === 'sniper'
              ? 720
              : 430;
        bot.moveDirection = distance > preferred ? Math.sign(dx) : -Math.sign(dx);
      } else {
        const navigationTarget = this.navigation.nextToward(
          { x: bot.x, y: bot.y },
          remembersTarget
            ? { x: bot.lastKnownTargetX, y: bot.lastKnownTargetY }
            : this.mapSpawns[Math.floor(bot.random.next() * this.mapSpawns.length)],
        );
        bot.moveDirection = navigationTarget ? Math.sign(navigationTarget.x - bot.x) : 0;
      }
      if (visible && bot.random.chance(this.difficulty.grenadeProbability)) this.throwGrenade(bot);
      bot.debugTag?.setText(bot.behavior.toUpperCase());
    }
    const navigationAcceleration = this.currentMap.id === 'frost-relay' ? 610 : 760;
    bot.setAccelerationX(bot.moveDirection * navigationAcceleration);
    const targetY = remembersTarget ? bot.lastKnownTargetY : target.y;
    const mapJetBias = this.currentMap.id === 'sky-fortress' ? 1.45 : 1;
    const trainAvoidance =
      this.currentMap.id === 'neon-underpass' && bot.y > this.currentMap.worldBounds.height - 190;
    const shouldJet =
      targetY < bot.y - 60 ||
      body.blocked.left ||
      body.blocked.right ||
      trainAvoidance ||
      bot.random.chance(bot.jumpBias * dt * this.difficulty.jetEfficiency * mapJetBias);
    const jetDisabled = ((bot.getData('jetDisabledUntil') as number | undefined) ?? 0) > time;
    bot.jetActive = !jetDisabled && shouldJet && bot.fuel > 8;
    if (bot.jetActive) {
      bot.setAccelerationY(-1230);
      bot.fuel = Math.max(0, bot.fuel - 24 * dt);
    } else {
      bot.setAccelerationY(0);
      bot.fuel = Math.min(100, bot.fuel + 17 * dt);
    }
    const aimOffset = (bot.getData('aimOffset') as number | undefined) ?? 0;
    const desiredAim =
      Math.atan2(bot.lastKnownTargetY - bot.y, bot.lastKnownTargetX - bot.x) + aimOffset;
    bot.aimAngle = Phaser.Math.Angle.RotateTo(
      bot.aimAngle,
      desiredAim,
      this.difficulty.aimTrackingSpeed * dt * 5,
    );
    if (visible && time >= bot.reactionReadyAt && distance < 900 && Math.abs(dy) < 430)
      this.fireWeapon(bot, time);
  }

  private updateActorsVisuals(): void {
    this.actors.children.iterate((child) => {
      const actor = child as ActorSprite;
      if (!actor?.alive) return true;
      const cos = Math.cos(actor.aimAngle);
      actor.setFlipX(cos < 0);
      actor.gun.setPosition(actor.x + cos * 24, actor.y - 7 + Math.sin(actor.aimAngle) * 14);
      actor.gun.setRotation(actor.aimAngle).setFlipY(cos < 0);
      const body = actor.body as Phaser.Physics.Arcade.Body;
      const animationKey = `${actor.texture.key}-move`;
      if (Math.abs(body.velocity.x) > 35 || actor.jetActive) actor.anims.play(animationKey, true);
      else if (actor.anims.isPlaying) {
        actor.anims.stop();
        actor.setFrame(0);
      }
      actor.nameTag.setPosition(actor.x, actor.y - 52);
      actor.debugTag?.setPosition(actor.x, actor.y + 48);
      return true;
    });
  }

  private updateProjectiles(time: number): void {
    this.bullets.children.iterate((child) => {
      const bullet = child as ProjectileSprite;
      const bounds = this.currentMap.worldBounds;
      if (
        bullet?.active &&
        (time > bullet.expireAt ||
          bullet.x < -40 ||
          bullet.x > bounds.width + 40 ||
          bullet.y < -40 ||
          bullet.y > bounds.height + 40)
      ) {
        this.releaseBullet(bullet);
      }
      return true;
    });
  }

  private updateCrosshair(): void {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.crosshair.setVisible(!coarse && this.matchState.state !== 'menu');
    if (!coarse)
      this.crosshair.setPosition(this.input.activePointer.worldX, this.input.activePointer.worldY);
  }

  private updateGamepadPause(): void {
    const pressed = Boolean(this.input.gamepad?.getPad(0)?.buttons[9]?.pressed);
    if (pressed && !this.gamepadPauseHeld) this.togglePause();
    this.gamepadPauseHeld = pressed;
  }

  private teamColor(teamId: TeamId): string {
    const palettes: Record<ColorVisionMode, Record<TeamId, string>> = {
      default: { ranger: '#79ead5', raiders: '#f3c467' },
      deuteranopia: { ranger: '#66b5ff', raiders: '#ffbf47' },
      protanopia: { ranger: '#55c7ff', raiders: '#ffe06b' },
      tritanopia: { ranger: '#5fe090', raiders: '#ff7098' },
    };
    return palettes[this.colorVision][teamId];
  }

  private animatePickups(time: number): void {
    this.pickups.children.iterate((child) => {
      const item = child as PickupSprite;
      if (item?.active) {
        item.setRotation(Math.sin(time * 0.001 + item.x) * 0.05);
        const remaining = item.expiresAt - time;
        item.setAlpha(remaining < 3000 ? 0.45 + Math.abs(Math.sin(time * 0.012)) * 0.55 : 1);
        item.outline?.setAlpha(item.alpha);
        item.label?.setPosition(item.x, item.y - 34).setAlpha(item.alpha);
      }
      return true;
    });
  }

  private platformObstacles(): RectangleObstacle[] {
    return this.obstacleCache;
  }

  private fireWeapon(actor: ActorSprite, time: number): void {
    if (!actor.alive) return;
    const weapon = WEAPONS[actor.weaponId];
    const ammo = actor.ammo[actor.weaponId];
    if (ammo.mag <= 0) {
      this.startReload(actor);
      return;
    }
    if (!canFire(ammo, actor.reloading, time, actor.lastShotAt, weapon)) return;
    ammo.mag -= 1;
    if (actor.isPlayer) this.trainingShots += weapon.pellets;
    actor.lastShotAt = time;
    actor.shotHeat = Math.min(1, actor.shotHeat + 0.08);
    const body = actor.body as Phaser.Physics.Arcade.Body;
    const movingSpread = Math.abs(body.velocity.x) > 80 ? weapon.movingSpreadRadians : 0;
    const airborneSpread = body.blocked.down ? 0 : weapon.airborneSpreadRadians;
    const spread =
      weapon.spreadRadians + movingSpread + airborneSpread + actor.shotHeat * weapon.spreadRadians;
    for (let index = 0; index < weapon.pellets; index += 1) {
      const angle = actor.aimAngle + Phaser.Math.FloatBetween(-spread, spread);
      const bullet = this.bullets.get(
        actor.x + Math.cos(angle) * 42,
        actor.y - 7 + Math.sin(angle) * 23,
        'bullet',
      ) as ProjectileSprite | null;
      if (!bullet) continue;
      bullet.enableBody(false, bullet.x, bullet.y, true, true);
      bullet.projectileId = `projectile-${nextProjectileId++}` as ProjectileSprite['projectileId'];
      bullet.owner = actor;
      bullet.damage = weapon.damage;
      bullet.expireAt = time + weapon.projectileLifetimeMs;
      bullet.weaponId = actor.weaponId;
      bullet.originX = actor.x;
      bullet.originY = actor.y;
      bullet
        .setTint(weapon.color)
        .setScale(weapon.category === 'launcher' ? 1.3 : weapon.category === 'energy' ? 1.18 : 0.68)
        .setRotation(angle)
        .setDepth(28);
      const bulletBody = bullet.body as Phaser.Physics.Arcade.Body;
      bulletBody
        .setAllowGravity(weapon.projectileGravity > 0)
        .setGravityY(weapon.projectileGravity);
      bullet.setVelocity(
        Math.cos(angle) * weapon.projectileSpeed,
        Math.sin(angle) * weapon.projectileSpeed,
      );
    }
    const actorBody = actor.body as Phaser.Physics.Arcade.Body;
    actor.setVelocityX(actorBody.velocity.x - Math.cos(actor.aimAngle) * weapon.recoilImpulse * 9);
    this.muzzleFlash(actor, weapon.color);
    const frequency =
      weapon.category === 'shotgun'
        ? 88
        : weapon.category === 'energy'
          ? 420
          : weapon.category === 'launcher'
            ? 58
            : 145;
    this.soundEffect(
      frequency,
      weapon.category === 'launcher' ? 0.12 : 0.045,
      weapon.category === 'shotgun' || weapon.category === 'launcher' ? 'sawtooth' : 'square',
    );
    this.eventsBus.emit('weapon:fired', { actorId: actor.id, weaponId: actor.weaponId });
    if (actor.isPlayer) this.updateHud();
  }

  private startReload(actor: ActorSprite): void {
    if (!actor?.alive || actor.reloading) return;
    const weaponId = actor.weaponId;
    const weapon = WEAPONS[weaponId];
    const ammo = actor.ammo[weaponId];
    if (ammo.mag >= weapon.magazineSize || ammo.reserve <= 0) return;
    actor.reloading = true;
    actor.reloadToken += 1;
    const token = actor.reloadToken;
    if (actor.isPlayer) this.updateHud();
    const reloadMs =
      actor.isPlayer && this.selectedPerk === 'quick-hands'
        ? weapon.reloadMs * 0.88
        : weapon.reloadMs;
    this.time.delayedCall(reloadMs, () => {
      if (!actor.active || actor.reloadToken !== token || actor.weaponId !== weaponId) return;
      actor.ammo[weaponId] = completeReload(ammo, weapon.magazineSize);
      actor.reloading = false;
      this.eventsBus.emit('weapon:reloaded', { actorId: actor.id, weaponId });
      if (actor.isPlayer) this.updateHud();
      this.soundEffect(520, 0.06, 'triangle');
    });
  }

  private switchWeapon(actor: ActorSprite, weaponId: WeaponId): void {
    if (!actor.alive || !actor.weaponSlots.includes(weaponId)) return;
    actor.reloadToken += 1;
    actor.reloading = false;
    actor.weaponId = weaponId;
    actor.gun.setTexture(WEAPONS[weaponId].spriteKey);
    this.eventsBus.emit('weapon:switched', { actorId: actor.id, weaponId });
    this.soundEffect(620, 0.035, 'triangle');
    if (actor.isPlayer) this.updateHud();
  }

  private equipWorldWeapon(
    actor: ActorSprite,
    weaponId: WeaponId,
    dropReplacedWeapon = true,
  ): void {
    const result = equipPickedWeapon(actor.weaponSlots, actor.weaponId, weaponId);
    actor.weaponSlots = result.slots;
    actor.ammo[weaponId] = {
      mag: WEAPONS[weaponId].magazineSize,
      reserve: actor.isPlayer ? WEAPONS[weaponId].reserveAmmo : 999,
    };
    if (result.droppedWeaponId && dropReplacedWeapon) {
      this.addPickup(
        actor.x,
        actor.y - 18,
        WEAPONS[result.droppedWeaponId].spriteKey,
        'weapon',
        result.droppedWeaponId,
        20_000,
        actor.id,
      );
    }
    this.switchWeapon(actor, result.activeWeaponId);
  }

  private throwGrenade(actor: ActorSprite): void {
    const now = this.time.now;
    if (
      !actor.alive ||
      actor.grenades <= 0 ||
      now < actor.grenadeReadyAt ||
      this.matchState.state !== 'playing'
    )
      return;
    const definition = GRENADES[actor.grenadeId];
    actor.grenades -= 1;
    actor.grenadeReadyAt = now + 4200;
    const grenade = this.grenades.create(actor.x, actor.y - 10, 'grenade') as GrenadeSprite;
    grenade.setDepth(29).setBounce(0.58).setCircle(10);
    grenade.setVelocity(Math.cos(actor.aimAngle) * 470, Math.sin(actor.aimAngle) * 470 - 130);
    grenade.owner = actor;
    grenade.setAngularVelocity(420);
    this.eventsBus.emit('grenade:thrown', { actorId: actor.id });
    grenade.setTint(definition.color).setData('grenadeId', actor.grenadeId);
    this.time.delayedCall(definition.fuseMs, () => {
      if (grenade.active) this.explodeGrenade(grenade);
    });
    if (actor.isPlayer) this.updateHud();
  }

  private explodeGrenade(grenade: GrenadeSprite): void {
    const { x, y, owner } = grenade;
    const grenadeId = grenade.getData('grenadeId') as ActorSprite['grenadeId'];
    const definition = GRENADES[grenadeId];
    grenade.destroy();
    const ring = this.add.circle(x, y, 18, definition.color, 0.76).setDepth(60);
    this.tweens.add({
      targets: ring,
      radius: definition.radius,
      alpha: 0,
      duration: 340,
      onComplete: () => ring.destroy(),
    });
    this.burst(x, y, definition.color, 30, 240);
    this.shakeCamera(170, 0.008);
    this.soundEffect(48, 0.2, 'sawtooth');
    if (grenadeId === 'smoke') {
      this.smokeZones.push({ x, y, radius: definition.radius, expiresAt: this.time.now + 5000 });
      const smoke = this.add.circle(x, y, definition.radius, definition.color, 0.28).setDepth(58);
      smoke.setData('blocksSight', true);
      this.tweens.add({
        targets: smoke,
        alpha: 0,
        delay: 4200,
        duration: 800,
        onComplete: () => smoke.destroy(),
      });
    }
    this.actors.children.iterate((child) => {
      const actor = child as ActorSprite;
      if (!actor?.alive || actor === owner || actor.teamId === owner.teamId) return true;
      const distance = Phaser.Math.Distance.Between(x, y, actor.x, actor.y);
      let damage = radialDamage(definition.centerDamage, distance, definition.radius);
      if (actor.isPlayer && this.selectedPerk === 'blast-lining')
        damage = Math.round(damage * 0.82);
      if (damage > 0) this.damageActor(actor, damage, owner);
      if (grenadeId === 'shock' && distance < definition.radius)
        actor.setData('jetDisabledUntil', this.time.now + 1200);
      return true;
    });
  }

  private hitActor(bullet: ProjectileSprite, actor: ActorSprite): void {
    if (
      !bullet.active ||
      !actor.alive ||
      actor === bullet.owner ||
      actor.teamId === bullet.owner.teamId
    )
      return;
    const owner = bullet.owner;
    const weapon = WEAPONS[bullet.weaponId];
    if (weapon.category === 'launcher') {
      this.explodeProjectile(bullet);
      return;
    }
    const distance = Phaser.Math.Distance.Between(
      bullet.originX,
      bullet.originY,
      bullet.x,
      bullet.y,
    );
    const body = actor.body as Phaser.Physics.Arcade.Body;
    const region = hitRegionForOffset(bullet.y - body.top, body.height);
    const result = applyBulletDamage(actor.health, actor.armor, weapon, distance, region);
    if (owner.isPlayer) {
      this.trainingHits += 1;
      this.trainingDamage += result.appliedToHealth;
    }
    this.burst(bullet.x, bullet.y, bullet.tintTopLeft || 0xf2bd55, 6, 95);
    this.releaseBullet(bullet);
    actor.armor = result.armor;
    this.damageActor(actor, result.appliedToHealth, owner, true);
  }

  private impactProjectile(bullet: ProjectileSprite): void {
    if (WEAPONS[bullet.weaponId].category === 'launcher') this.explodeProjectile(bullet);
    else this.releaseBullet(bullet);
  }

  private explodeProjectile(projectile: ProjectileSprite): void {
    if (!projectile.active) return;
    const weapon = WEAPONS[projectile.weaponId];
    const { x, y, owner } = projectile;
    this.releaseBullet(projectile);
    const ring = this.add.circle(x, y, 16, weapon.color, 0.8).setDepth(60);
    this.tweens.add({
      targets: ring,
      radius: weapon.splashRadius,
      alpha: 0,
      duration: 300,
      onComplete: () => ring.destroy(),
    });
    this.actors.children.iterate((child) => {
      const actor = child as ActorSprite;
      if (!actor?.alive) return true;
      const distance = Phaser.Math.Distance.Between(x, y, actor.x, actor.y);
      let damage = radialDamage(weapon.damage, distance, weapon.splashRadius);
      if (actor === owner) damage = Math.round(damage * 0.5);
      if (actor.isPlayer && this.selectedPerk === 'blast-lining')
        damage = Math.round(damage * 0.82);
      if (damage > 0 && (actor.teamId !== owner.teamId || actor === owner))
        this.damageActor(actor, damage, owner);
      return true;
    });
  }

  private releaseBullet(bullet: ProjectileSprite): void {
    if (!bullet.active) return;
    this.burst(bullet.x, bullet.y, bullet.tintTopLeft || 0xd9c080, 4, 55);
    bullet.disableBody(true, true).clearTint();
  }

  private damageActor(
    actor: ActorSprite,
    amount: number,
    source: ActorSprite,
    bypassArmor = false,
  ): void {
    if (actor.isPlayer && !source.isPlayer && source !== actor)
      amount = Math.max(1, Math.round(amount * this.difficulty.botDamageMultiplier));
    let healthDamage = amount;
    if (!bypassArmor && actor.armor > 0) {
      const armorDamage = Math.min(actor.armor, Math.round(amount * 0.5));
      actor.armor -= armorDamage;
      healthDamage -= armorDamage;
    }
    actor.health = reduceHealth(actor.health, healthDamage);
    actor.setTintFill(0xff6a54);
    this.time.delayedCall(70, () => actor.active && actor.clearTint());
    this.eventsBus.emit('actor:damaged', { actorId: actor.id, amount, sourceId: source.id });
    if (actor.isPlayer) {
      this.ui.damageFlash();
      this.shakeCamera(80, 0.003);
      this.updateHud();
    }
    if (actor.health <= 0) this.killActor(actor, source);
  }

  private killActor(actor: ActorSprite, killer: ActorSprite): void {
    if (!actor.alive) return;
    actor.alive = false;
    actor.setActive(false).setVisible(false);
    (actor.body as Phaser.Physics.Arcade.Body).enable = false;
    actor.gun.setVisible(false);
    actor.nameTag.setVisible(false);
    actor.debugTag?.setVisible(false);
    this.burst(actor.x, actor.y, actor.isPlayer ? 0x4fe0c7 : 0xef6e55, 24, 205);
    this.shakeCamera(130, 0.005);
    this.eventsBus.emit('actor:eliminated', { actorId: actor.id, sourceId: killer.id });
    if (killer === actor) {
      if (actor.isPlayer) {
        this.enemyScore += 1;
        this.ui.addFeed('<b>RANGER</b> was caught in the blast');
      }
    } else if (killer.isPlayer) {
      this.playerScore += 1;
      this.ui.addFeed(`<b>RANGER</b> eliminated ${actor.actorName}`);
    } else if (actor.isPlayer) {
      this.enemyScore += 1;
      this.ui.addFeed(`${killer.actorName} eliminated <b>RANGER</b>`);
    }
    const scoringTeam =
      killer === actor ? (actor.teamId === 'ranger' ? 'raiders' : 'ranger') : killer.teamId;
    registerElimination(
      this.modeRuntime,
      scoringTeam,
      actor.isPlayer,
      killer.isPlayer && killer !== actor,
    );
    this.playerScore = Math.floor(this.modeRuntime.rangerScore);
    this.enemyScore = Math.floor(this.modeRuntime.raiderScore);
    if (this.currentMode.id === 'gun-ladder' && killer.isPlayer && killer !== actor) {
      const weaponId = currentLadderWeapon(this.modeRuntime);
      this.equipWorldWeapon(this.player, weaponId, false);
      this.announce(`LADDER: ${WEAPONS[weaponId].displayName}`, WEAPONS[weaponId].color);
    }
    this.updateHud();
    if (this.modeRuntime.finished) {
      this.endMatch(this.modeRuntime.victory);
      return;
    }
    if (this.currentMode.id === 'survival') {
      if (actor.isPlayer) return;
      if (!this.bots.some((bot) => bot.alive) && !this.survivalWavePending)
        this.queueSurvivalWave();
      return;
    }
    this.time.delayedCall(1250, () => this.respawnActor(actor));
  }

  private queueSurvivalWave(): void {
    this.survivalWavePending = true;
    completeSurvivalWave(this.modeRuntime);
    this.announce(`WAVE ${this.modeRuntime.wave} INCOMING`, 0xf2c15a);
    this.time.delayedCall(20_000, () => {
      if (this.matchState.state !== 'playing') return;
      this.player.health = Math.min(100, this.player.health + 20);
      this.bots.forEach((bot) => this.respawnActor(bot));
      this.survivalWavePending = false;
    });
  }

  private respawnActor(actor: ActorSprite): void {
    if (this.matchState.state !== 'playing') return;
    const enemies = [this.player, ...this.bots]
      .filter((enemy) => enemy !== actor && enemy.teamId !== actor.teamId)
      .filter((enemy) => enemy.alive)
      .map((enemy) => ({ x: enemy.x, y: enemy.y }));
    const spawn = chooseSafestSpawn(this.mapSpawns, enemies);
    actor.setPosition(spawn.x, spawn.y).setVelocity(0, 0).setAcceleration(0, 0);
    const waveMultiplier =
      this.currentMode.id === 'survival' ? 1 + (this.modeRuntime.wave - 1) * 0.08 : 1;
    actor.health = actor.isPlayer
      ? 100
      : Math.round(100 * this.difficulty.botHealthMultiplier * waveMultiplier);
    actor.armor = 0;
    actor.fuel = 100;
    actor.alive = true;
    actor.setActive(true).setVisible(true).clearTint();
    (actor.body as Phaser.Physics.Arcade.Body).enable = true;
    actor.gun.setVisible(true);
    actor.nameTag.setVisible(true);
    actor.debugTag?.setVisible(true);
    actor.reloading = false;
    actor.reloadToken += 1;
    actor.grenades = GRENADES[actor.grenadeId].maximumCarried;
    WEAPON_IDS.forEach((weaponId) => {
      actor.ammo[weaponId].mag = WEAPONS[weaponId].magazineSize;
    });
    this.spawnEffect(spawn.x, spawn.y);
    if (actor.isPlayer) {
      this.cameras.main.centerOn(actor.x, actor.y);
      this.updateHud();
    }
  }

  private collectPickup(actor: ActorSprite, item: PickupSprite, forceWeaponPickup = false): void {
    if (!item.active || !actor.alive) return;
    const blockedActorId = item.getData('blockedActorId') as ActorSprite['id'] | undefined;
    const pickupReadyAt = (item.getData('pickupReadyAt') as number | undefined) ?? 0;
    if (blockedActorId === actor.id && this.time.now < pickupReadyAt) return;
    const type = item.getData('type') as string;
    const value = item.getData('value') as WeaponId | undefined;
    if (type === 'health') {
      const maximumHealth = actor.isPlayer
        ? 100
        : Math.round(100 * this.difficulty.botHealthMultiplier);
      if (actor.health >= maximumHealth) return;
      actor.health = Math.min(maximumHealth, actor.health + 40);
      if (actor.isPlayer) this.announce('+40 HEALTH', 0xef7057);
    } else if (type === 'armor') {
      const armorMaximum = actor.isPlayer && this.selectedPerk === 'light-frame' ? 40 : 50;
      if (actor.armor >= armorMaximum) return;
      actor.armor = Math.min(armorMaximum, actor.armor + 25);
      if (actor.isPlayer) this.announce('+25 ARMOR', 0xf2c15a);
    } else if (type === 'fuel') {
      actor.fuel = 100;
      if (actor.isPlayer) this.announce('JET FUEL FULL', 0x55dfc8);
    } else if (type === 'weapon' && value) {
      if (actor.isPlayer && actor.weaponSlots.length >= 2 && !forceWeaponPickup) {
        if (this.nearbyWeaponPickup !== item) {
          this.nearbyWeaponPickup = item;
          this.ui.showWeaponPickup(value);
        }
        return;
      }
      this.equipWorldWeapon(actor, value);
      if (actor.isPlayer)
        this.announce(`${WEAPONS[value].displayName} ACQUIRED`, WEAPONS[value].color);
    }
    this.eventsBus.emit('pickup:collected', { pickupId: item.pickupId, actorId: actor.id });
    this.soundEffect(760, 0.09, 'sine');
    if (actor.isPlayer) this.updateHud();
    this.removePickup(item);
  }

  private updateWeaponPickupPrompt(): void {
    if (!this.player?.alive || this.player.weaponSlots.length < 2) {
      this.nearbyWeaponPickup = undefined;
      this.ui.hideWeaponPickup();
      return;
    }
    const nearby = this.pickups
      .getChildren()
      .map((child) => child as PickupSprite)
      .filter((item) => {
        if (!item.active || item.getData('type') !== 'weapon' || !item.getData('value'))
          return false;
        const blockedActorId = item.getData('blockedActorId') as ActorSprite['id'] | undefined;
        const readyAt = (item.getData('pickupReadyAt') as number | undefined) ?? 0;
        return (
          !(blockedActorId === this.player.id && this.time.now < readyAt) &&
          Phaser.Math.Distance.Between(this.player.x, this.player.y, item.x, item.y) <= 96
        );
      })
      .sort(
        (first, second) =>
          Phaser.Math.Distance.Between(this.player.x, this.player.y, first.x, first.y) -
          Phaser.Math.Distance.Between(this.player.x, this.player.y, second.x, second.y),
      )[0];
    if (!nearby) {
      this.nearbyWeaponPickup = undefined;
      this.ui.hideWeaponPickup();
      return;
    }
    if (this.nearbyWeaponPickup !== nearby) {
      this.nearbyWeaponPickup = nearby;
      this.ui.showWeaponPickup(nearby.getData('value') as WeaponId);
    }
  }

  private applyHazard(actor: ActorSprite, hazard: Phaser.Physics.Arcade.Image): void {
    if (!actor.alive) return;
    const hazardType = hazard.getData('hazardType') as string;
    if (!hazardAffectsActor(hazardType, actor.isPlayer)) return;
    const lastHazardAudio = (hazard.getData('audioAt') as number | undefined) ?? -Infinity;
    if (actor.isPlayer && this.time.now - lastHazardAudio > 650) {
      hazard.setData('audioAt', this.time.now);
      const frequency =
        hazardType === 'ice'
          ? 540
          : hazardType === 'wind'
            ? 210
            : hazardType === 'laser'
              ? 880
              : 72;
      this.soundEffect(frequency, 0.09, hazardType === 'laser' ? 'square' : 'triangle');
    }
    if (hazardType === 'kill' || hazardType === 'train') {
      if (actor.getData('killHazardPending')) return;
      actor.setData('killHazardPending', true);
      this.time.delayedCall(600, () => {
        actor.setData('killHazardPending', false);
        if (actor.alive) this.damageActor(actor, 999, actor, true);
      });
    } else if (hazardType === 'conveyor') {
      const speed = hazard.getData('speed') as number;
      const body = actor.body as Phaser.Physics.Arcade.Body;
      actor.setVelocityX(Phaser.Math.Clamp(body.velocity.x + speed, -420, 420));
    } else if (hazardType === 'ice') {
      actor.setData('iceUntil', this.time.now + 180);
      actor.setDragX(45);
    } else if (hazardType === 'wind') {
      const speed = hazard.getData('speed') as number;
      actor.setVelocityX(
        Phaser.Math.Clamp(
          (actor.body as Phaser.Physics.Arcade.Body).velocity.x + speed * 0.08,
          -480,
          480,
        ),
      );
      actor.setData('windUntil', this.time.now + 180);
    } else if (hazardType === 'laser') {
      const lastDamage = (actor.getData('lastLaserDamage') as number | undefined) ?? -Infinity;
      if (this.time.now - lastDamage >= 300) {
        actor.setData('lastLaserDamage', this.time.now);
        this.damageActor(actor, 12, actor, true);
      }
    } else if (hazardType === 'vent') {
      const cycle = this.time.now % 5000;
      const lastDamage = (actor.getData('lastVentDamage') as number | undefined) ?? -Infinity;
      if (cycle >= 1000 && cycle < 3000 && this.time.now - lastDamage >= 250) {
        actor.setData('lastVentDamage', this.time.now);
        actor.setVelocityY(-260);
        this.damageActor(actor, 5, actor, true);
      }
    }
  }

  private endMatch(victory: boolean): void {
    if (this.matchEnded || this.matchState.state !== 'playing') return;
    this.matchEnded = true;
    this.matchState.transition('roundEnd');
    this.matchState.transition('results');
    this.physics.pause();
    this.ambience.stop();
    this.jetEmitter.emitting = false;
    this.supplyDropTimer?.remove(false);
    const elapsedSeconds = Math.max(1, (this.time.now - this.matchStartedAt) / 1000);
    const accuracy =
      this.trainingShots > 0 ? Math.round((this.trainingHits / this.trainingShots) * 100) : 0;
    const stats =
      this.currentMode.id === 'training-range'
        ? `${accuracy}% accuracy | ${Math.round(this.trainingDamage / elapsedSeconds)} DPS | ${this.trainingDamage} damage`
        : `${this.modeRuntime.playerEliminations} eliminations | ${this.modeRuntime.playerDeaths} deaths | ${this.currentMode.displayName}`;
    const repository = getSaveRepository();
    repository.save(
      applyMatchReward(repository.load(), {
        modeId: this.currentMode.id,
        weaponId: this.player.weaponId,
        victory,
        eliminations: this.modeRuntime.playerEliminations,
        score: this.playerScore,
        difficultyMultiplier: this.difficulty.scoreMultiplier,
      }),
    );
    this.ui.showResult(victory, this.playerScore, this.enemyScore, stats);
    this.eventsBus.emit('match:ended', {
      victory,
      playerScore: this.playerScore,
      enemyScore: this.enemyScore,
    });
    this.shakeCamera(180, 0.004);
    this.soundEffect(victory ? 520 : 94, 0.35, victory ? 'triangle' : 'sawtooth', 'ui');
  }

  private updateHud(): void {
    if (!this.player) return;
    this.ui.update({
      playerHealth: this.player.health,
      playerArmor: this.player.armor,
      playerFuel: this.player.fuel,
      playerScore: this.playerScore,
      enemyScore: this.enemyScore,
      timeLeft: this.timeLeft,
      weaponId: this.player.weaponId,
      weaponSlots: [...this.player.weaponSlots],
      ammo: this.player.ammo[this.player.weaponId],
      reloading: this.player.reloading,
      grenadeId: this.player.grenadeId,
      grenades: this.player.grenades,
      modeLabel: this.modeHudLabel(),
    });
  }

  private setupModeObjective(): void {
    this.controlZone?.destroy();
    this.controlZone = undefined;
    if (this.currentMode.id !== 'control-point') return;
    const point = this.mapSpawns[2 % this.mapSpawns.length];
    this.controlZone = this.add
      .circle(point.x, point.y, 92, 0x4fd3c0, 0.16)
      .setStrokeStyle(4, 0x78e3d0, 0.7)
      .setDepth(12);
  }

  private updateControlZone(): void {
    if (!this.controlZone) return;
    const point = this.mapSpawns[(this.modeRuntime.objectiveIndex * 2 + 2) % this.mapSpawns.length];
    this.controlZone.setPosition(point.x, point.y);
    const owner = this.controlPointOwner();
    const color = owner === 'ranger' ? 0x4fd3c0 : owner === 'raiders' ? 0xef705c : 0xf2c15a;
    this.controlZone.setFillStyle(color, 0.16).setStrokeStyle(4, color, 0.72);
  }

  private controlPointOwner(): 'ranger' | 'raiders' | null {
    if (!this.controlZone) return null;
    let ranger = 0;
    let raiders = 0;
    [this.player, ...this.bots].forEach((actor) => {
      if (
        !actor?.alive ||
        Phaser.Math.Distance.Between(actor.x, actor.y, this.controlZone!.x, this.controlZone!.y) >
          92
      )
        return;
      if (actor.teamId === 'ranger') ranger += 1;
      else raiders += 1;
    });
    if (ranger > 0 && raiders === 0) return 'ranger';
    if (raiders > 0 && ranger === 0) return 'raiders';
    return null;
  }

  private modeHudLabel(): string {
    if (this.currentMode.id === 'survival') return `WAVE ${this.modeRuntime.wave}`;
    if (this.currentMode.id === 'control-point')
      return `CONTROL ${this.modeRuntime.objectiveIndex + 1}`;
    if (this.currentMode.id === 'training-range') return 'TRAINING';
    return this.currentMode.displayName.toUpperCase();
  }

  private muzzleFlash(actor: ActorSprite, color: number): void {
    const x = actor.x + Math.cos(actor.aimAngle) * 55;
    const y = actor.y - 7 + Math.sin(actor.aimAngle) * 32;
    this.burst(x, y, color, 3, 70);
  }

  private burst(x: number, y: number, color: number, count: number, speed: number): void {
    void speed;
    this.burstEmitter.setParticleTint(color);
    const budgetedCount = Math.max(1, Math.round(count * this.graphicsProfile.particleMultiplier));
    this.burstEmitter.emitParticleAt(x, y, Math.min(budgetedCount, 18));
  }

  private shakeCamera(duration: number, intensity: number): void {
    if (this.reducedMotion || this.cameraShake <= 0) return;
    this.cameras.main.shake(duration, intensity * this.cameraShake);
  }

  private spawnEffect(x: number, y: number): void {
    const circle = this.add
      .circle(x, y, 12, 0x5de4cf, 0.15)
      .setStrokeStyle(3, 0x75ecd8, 0.9)
      .setDepth(64);
    this.tweens.add({
      targets: circle,
      scale: 5,
      alpha: 0,
      duration: 520,
      onComplete: () => circle.destroy(),
    });
  }

  private announce(text: string, color: number): void {
    const banner = this.add
      .text(WORLD_WIDTH / 2, 132, text, {
        fontFamily: 'Barlow Condensed',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#f7f0dd',
        backgroundColor: '#06151de6',
        padding: { x: 24, y: 10 },
        stroke: Phaser.Display.Color.IntegerToColor(color).rgba,
        strokeThickness: 1,
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.tweens.add({
      targets: banner,
      y: 120,
      alpha: 0,
      delay: 850,
      duration: 260,
      onComplete: () => banner.destroy(),
    });
  }

  private soundEffect(
    frequency: number,
    duration: number,
    type: OscillatorType,
    channel: 'effects' | 'ui' = 'effects',
  ): void {
    const channelVolume = channel === 'ui' ? this.uiVolume : this.effectsVolume;
    if (this.activeAudioVoices >= 12 || this.masterVolume <= 0 || channelVolume <= 0) return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context =
      (this.registry.get('audioContext') as AudioContext | undefined) ?? new AudioContextClass();
    this.registry.set('audioContext', context);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    this.activeAudioVoices += 1;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(25, frequency * 0.55),
      context.currentTime + duration,
    );
    gain.gain.setValueAtTime(0.055 * this.masterVolume * channelVolume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
    oscillator.addEventListener('ended', () => {
      this.activeAudioVoices = Math.max(0, this.activeAudioVoices - 1);
    });
  }
}
