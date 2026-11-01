# Flashfire deployment notes for Hallab

Flashfire is published free on UTXOPlay, credited to **Hallab**, using the supplied CKB address. The short address and its canonical full form identify the same lock script; no wallet signature, payout transaction, login session or committee approval is fabricated by publication.

## Fixed for hosting

- Absolute asset and `/lobby` routes could leave the hosted game path, and history changes fail in an opaque iframe. Asset URLs now use the Vite base; hosted navigation stays inside the game.
- Direct access to localStorage could throw before the game initialized. Storage now falls back to memory when unavailable. The hosted menu/listing disclose that reload resets progress. A platform-scoped save bridge would be a useful follow-up; persistent browser saves still work standalone.
- Phaser's default XHR image/JSON loader conflicts with the Store's `connect-src 'none'` isolation. Images use the supported HTML image loader, map data is bundled, and fonts are self-hosted.
- Touch movement could trigger the mouse-fire path. Mouse fire now excludes touch pointers. Lost capture, pause and rotation clear touch/keyboard inputs.
- Canvas backing previously grew to full 4K. The adapted renderer caps backing at 3.6 million pixels, fills the viewport, preserves standard display ratios and uses Phaser's inverse pointer transform.
- Added scoped loading/exit integration, supported fullscreen requests, a manual rotation fallback and generated promotional artwork matching the actual ranger/outpost theme.

## Worth reviewing next

`src/systems/MapSystem.ts` explicitly makes four hazard types (`kill`, `train`, `laser`, `vent`) damage only the player; bots are immune. This is preserved in the deployment, but it can make arenas feel unfair. Consider either making the rule clear or reviewing bot navigation and shared hazard damage together.

The hosted visit-only progression is a platform storage limitation, not cloud persistence. Long-term rank unlocks would benefit from a properly isolated save integration before advertising durable hosted progression.

Training completions currently receive the normal match XP reward, and the Finish Session button is available immediately. This permits repeated short sessions to farm rank/unlocks. Consider time- or objective-based training rewards as a separate gameplay change.
