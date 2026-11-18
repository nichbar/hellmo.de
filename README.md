# hellmo.de

Static live wallpaper wall displaying a mosaic of different album covers from [last.fm/user/nichbar](https://www.last.fm/user/nichbar) (led by your most recent album listen), with a minimal corner HUD linking to [github.com/nichbar](https://www.github.com/nichbar).

## How It Works (No Exposed API Key)

- A scheduled GitHub Actions workflow (`.github/workflows/update-lastfm.yml`) runs **every 6 hours** (`0 */6 * * *`) and executes `node scripts/fetch-lastfm.mjs`.
- The script reads `LASTFM_API_KEY` from **GitHub Repository Secrets**, fetches your recent tracks and top albums from Last.fm, and writes a static snapshot to `data/lastfm.json`.
- The browser loads `data/lastfm.json` directly—zero API keys in client-side code and zero Last.fm API calls per visitor.

## Setup

1. Create a free Last.fm API key at [last.fm/api/account/create](https://www.last.fm/api/account/create).
2. Push this repository to GitHub.
3. In your GitHub repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - Name: `LASTFM_API_KEY`
   - Value: your Last.fm API key
4. Trigger the first sync manually via **Actions → Update Last.fm data → Run workflow**.
   *(From then on, it updates automatically every 6 hours.)*
5. Enable **GitHub Pages** (**Settings → Pages → Deploy from a branch → `main` / `/`**). The included `CNAME` file configures `hellmo.de`.

## Local Preview

To populate `data/lastfm.json` locally (optional):

```bash
LASTFM_API_KEY=your-api-key node scripts/fetch-lastfm.mjs
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Controls

- **Tile size**: `−` / `+` buttons in the bottom-left HUD
- **Ambient drift**: `≈` button in the bottom-left HUD
- **Refresh**: `↻` button (re-checks `data/lastfm.json`)
- **Hide / Show HUD**: `◫` button or press `H` for pure wallpaper mode

## Tests

```bash
node --test tests/app.test.mjs
```
