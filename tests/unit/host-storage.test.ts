import { afterEach, expect, test, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test('blocked browser storage keeps progression and settings during the visit', async () => {
  vi.resetModules();
  vi.stubGlobal(
    'window',
    Object.defineProperty({}, 'localStorage', {
      get() {
        throw new DOMException('Opaque origin', 'SecurityError');
      },
    }),
  );
  const { getSaveRepository } = await import('../../src/persistence/SaveRepository');
  const repository = getSaveRepository(),
    save = repository.load();
  save.profile.totalMatches = 2;
  save.settings.masterVolume = 0.3;
  expect(repository.save(save)).toBe(true);
  expect(getSaveRepository().load().profile.totalMatches).toBe(2);
  expect(getSaveRepository().load().settings.masterVolume).toBe(0.3);
});
