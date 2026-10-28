import Phaser from 'phaser';
import { boundedViewport } from './hosting';
import { ArenaScene } from '../scenes/ArenaScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: 'game',
  ...boundedViewport(),
  backgroundColor: '#07161d',
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 860 }, debug: false },
  },
  scale: {
    mode: Phaser.Scale.NONE,
    ...boundedViewport(),
  },
  render: { antialias: true, roundPixels: false },
  input: { gamepad: true },
  loader: { imageLoadType: 'HTMLImageElement', crossOrigin: 'anonymous' },
  scene: [ArenaScene],
};
