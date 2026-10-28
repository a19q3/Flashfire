# Flashfire on UTXOPlay

Public URL: https://store.utxoplay.io/play/flashfire

Title: **Flashfire**. Developer/publisher: **Hallab**. Price: **free**. Supplied address: `ckb1qyqvwn96jszwwng76pm90uncye5qmkefwswscej370`. Its validated canonical CKB mainnet address is in `catalog-entry.json`. Attribution creates no wallet login, signature, payout transaction or committee membership.

Upstream: https://github.com/Hallab7/Flashfire at `4a778ed306727685ba95fc060e2d88452da1f6e6`. Changes are retained on local branch `codex/utxoplay-release`; upstream has read-only access. No source-repository transfer or overwrite is performed.

## Build and host

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm content:freeze
FLASHFIRE_BASE=/games/flashfire/ pnpm build
node host/start.mjs
```

The static service serves `/games/flashfire/` and `/health` on port 8080. Deploy via `deploy/compose.yml` on the existing internal `utxoplay-games` network. There is no public host port, wallet secret, backend simulation or writable game volume. Source maps are private and excluded from the deployment archive.

Store integration consists of `docs/catalog-entry.json`, the two files in `docs/assets/`, and a `runtime:browser` service entry pointing to `http://utxoplay-flashfire:8080` with `urlEnv:FLASHFIRE_URL`, `socket:false`, `recordReads:false`, `repository:Hallab7/Flashfire`. The deployed Store overlay preserves all existing catalog/service entries and other game containers.

## Isolation and presentation

The game runs in the Store's opaque `allow-scripts` iframe with `connect-src 'none'`. Scoped readiness/exit messages do not expose account data or runtime tokens. Assets use the hosted base path; images load through Phaser's HTML image loader, map JSON is bundled, and fonts are local with license notices. Hosted routes avoid the sandbox's history restriction. Dialogs replace native confirmation prompts.

Progress and settings persist in memory during the current visit; reload resets them. The game menu, listing and privacy page disclose this, and hosted export is hidden because the sandbox disallows downloads. Standalone localStorage saves and import/export remain supported. The save schema and all five frozen gameplay content files are unchanged. This game makes no signed replay, Myelin verification or settlement claim.

All UI lives inside the viewport. Canvas backing is bounded to 3.6 million pixels; the required wide display ratios remain exact and Phaser performs the inverse pointer transform. Touch play requires landscape, pauses and clears held inputs on rotation, and requests supported fullscreen/orientation APIs with manual fallback. The original quality/accessibility options remain available.

## Artwork and feedback

Generated with the built-in imagegen tool:

- [Portrait store card](assets/flashfire-cover.webp)
- [Wide launch banner](assets/flashfire-hero.webp), also installed in `public/assets/flashfire-hero.webp`
- [Exact prompts and reference inputs](assets/prompts.md)
- [Notes for Hallab](HALLAB-FEEDBACK.md)

## Deployment recovery

Server release directory: `/data/utxoplay/releases/20261028-flashfire-1.0.0/`. Images: `utxoplay:0.38.0-flashfire` and `utxoplay-flashfire:1.0.0-hallab`. The directory retains the exact prior Store Compose definition, pre-release catalog, consistent SQLite backup, source bundle and verification evidence. Private environment/Compose files stay server-only.

Only recreate the Store using `store-rollback.private.json` and Compose project `utxoplay` when rolling back this release. Keep the current platform database and all game data. Check for newer releases first; never use `--remove-orphans` to remove independently deployed game services.
