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

## Hosted update — 1 November 2026

UTXOPlay edition **1.0.1** merges upstream `dddc0dcbc26ec4ed00a1d9d31729b2fdb4c10561` with the original hosted adaptation `a27f953884cef40ef778ec4303cf6ff15f230ec8`. Hallab remains the developer/publisher. This local merge is not an upstream publication.

The update defaults new sessions to Recruit, reduces Recruit/Regular bot reaction speed, health and damage, gives weapons a difficulty-specific supply cooldown, and raises Quick Deathmatch to 20 eliminations. Higher difficulties retain full damage. Upstream storage improvements preserve readable standalone saves even when writes fail; hosted storage remains visit-only. The content-freeze manifest was renewed for the reviewed balance files and edition version; the verifier remains enabled. Weapon, grenade and map definitions are unchanged. There is no native verification, signed replay, ranked result, payment or settlement integration for this casual browser game.

The existing opaque sandbox, bundled maps, self-hosted fonts, route/asset base, capped canvas, input transform, landscape gate and Store fullscreen policy are retained. Deploy `.release/site` after the release checks; do not serve private source maps. The production helper is `deploy/flashfire-update-release.py` in the Store repository, with isolated staging, preservation checks and rollback. The original recovery section above describes the historical 1.0.0 release only.
