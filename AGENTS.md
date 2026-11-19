# Project Contract

## Build And Test

- Install / Build: none (zero-dependency static site; GitHub Actions uses Node.js 22)
- Local server: `python3 -m http.server 8080`
- Refresh snapshot locally: `LASTFM_API_KEY=<key> node scripts/fetch-lastfm.mjs`
- Test: `node --test tests/app.test.mjs`

## Architecture Boundaries

- `index.html` and `styles.css` hold the static shell, HUD markup, and wallpaper styling/animations
- `config.js` exports shared site defaults (`HELLMO_CONFIG` in browser, `module.exports` in Node); do not store secrets or `lastfmApiKey` here
- `app.js` is dual-environment: pure parsing, URL normalization, and grid-layout helpers live above `module.exports = exported`; browser DOM/state/fetch code must stay below the `typeof document === 'undefined' || typeof window === 'undefined'` guard
- `scripts/fetch-lastfm.mjs` is the Node ESM generator run by `.github/workflows/update-lastfm.yml` every 6 hours; reuse helpers from `app.js` and defaults from `config.js` instead of duplicating logic
- `data/lastfm.json` is the generated static Last.fm snapshot consumed by the browser (`config.dataUrl`)
- `tests/app.test.mjs` holds Node `node:test` unit tests for `config.js`, `app.js`, and `scripts/fetch-lastfm.mjs`
- `CNAME` configures the GitHub Pages custom domain (`hellmo.de`)

## Coding Conventions

- Keep zero npm runtime or build dependencies (vanilla browser JS/CSS; Node built-ins only in `scripts/` and `tests/`)
- Export any new pure data, URL, or layout logic in `app.js` (`exported`) so Node tests and `scripts/fetch-lastfm.mjs` can import it without a DOM
- Validate and upgrade album cover URLs via `isValidAlbumArtUrl` / `normalizeImageUrl` in `app.js` so `http://` becomes `https://` and Last.fm's placeholder hash (`2a96cbd8b46e442fc41c2b86b821562f`) is rejected
- Keep `nowPlaying: false` in snapshots written by `scripts/fetch-lastfm.mjs` so cached snapshots do not falsely show a live track hours later

## Safety Rails

### NEVER

- Commit API keys, `.env*` files, or secrets in `config.js`, `app.js`, `data/lastfm.json`, or `tests/` (`tests/app.test.mjs` asserts `'lastfmApiKey' in config` is `false`)
- Modify `CNAME` or `.github/workflows/update-lastfm.yml` schedule/permissions without explicit approval
- Rely on manual edits to `data/lastfm.json` (`.github/workflows/update-lastfm.yml` overwrites it every 6 hours)
- Make live network requests inside `tests/app.test.mjs`
- Commit without running `node --test tests/app.test.mjs`

### ALWAYS

- Show diff before committing
- Mock `globalThis.fetch` when testing network-facing logic in `tests/app.test.mjs`

## Verification

- JS, `config.js`, or `scripts/fetch-lastfm.mjs` changes: `node --test tests/app.test.mjs`
- UI (`index.html`, `styles.css`, browser code in `app.js`): `node --test tests/app.test.mjs` + serve with `python3 -m http.server 8080` and verify wall rendering, tile controls, and `H` HUD toggle

## Compact Instructions

Preserve:

1. Architecture decisions (NEVER summarize)
2. Modified files and key changes
3. Current verification status (pass/fail commands)
4. Open risks, TODOs, rollback notes
