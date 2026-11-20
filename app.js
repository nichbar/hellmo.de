(function (global) {
  'use strict';

  const LASTFM_PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f';
  const STORAGE_KEYS = {
    apiKey: 'hellmo_lastfm_api_key',
    tileSize: 'hellmo_tile_size',
    motion: 'hellmo_ambient_motion',
    hudHidden: 'hellmo_hud_hidden',
  };

  function isValidAlbumArtUrl(url) {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (trimmed.includes(LASTFM_PLACEHOLDER_HASH)) return false;
    return (
      trimmed.startsWith('https://') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('data:image/')
    );
  }

  function normalizeImageUrl(url) {
    if (!isValidAlbumArtUrl(url)) return null;
    const trimmed = url.trim();
    if (trimmed.startsWith('http://')) {
      return 'https://' + trimmed.slice('http://'.length);
    }
    return trimmed;
  }

  function extractBestImage(images) {
    if (!Array.isArray(images)) return null;
    const priority = ['extralarge', 'mega', 'large', 'medium', 'small'];
    for (const size of priority) {
      const match = images.find((img) => img && img.size === size);
      const url = normalizeImageUrl(match && match['#text']);
      if (url) return url;
    }
    for (const img of images) {
      const url = normalizeImageUrl(img && img['#text']);
      if (url) return url;
    }
    return null;
  }

  function normalizeTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const trackName = (raw.name || '').trim() || 'Unknown Track';
    const artistName =
      (raw.artist && (raw.artist['#text'] || raw.artist.name)) || 'Unknown Artist';
    const albumName =
      (raw.album && (raw.album['#text'] || raw.album.name)) || trackName;
    const nowPlaying = raw['@attr'] && raw['@attr'].nowplaying === 'true';
    const playedUts =
      raw.date && raw.date.uts ? Number.parseInt(raw.date.uts, 10) : null;

    return {
      trackName,
      artistName: artistName.trim(),
      albumName: albumName.trim(),
      nowPlaying: Boolean(nowPlaying),
      playedUts: Number.isFinite(playedUts) ? playedUts : null,
      trackUrl: typeof raw.url === 'string' && raw.url ? raw.url : null,
      imageUrl: extractBestImage(raw.image),
    };
  }

  function parseRecentTracks(payload) {
    if (!payload || typeof payload !== 'object') {
      return { primary: null, tracks: [] };
    }
    if (payload.error) {
      const err = new Error(payload.message || 'Last.fm API error');
      err.code = payload.error;
      throw err;
    }
    const rawTracks = payload.recenttracks && payload.recenttracks.track;
    const list = Array.isArray(rawTracks)
      ? rawTracks
      : rawTracks
      ? [rawTracks]
      : [];
    const tracks = list.map(normalizeTrack).filter(Boolean);
    return {
      primary: tracks[0] || null,
      tracks,
    };
  }

  function makeAlbumKey(artistName, albumName) {
    return `${String(artistName || '').trim().toLowerCase()}::${String(
      albumName || ''
    )
      .trim()
      .toLowerCase()}`;
  }

  function extractUniqueAlbums(tracks) {
    if (!Array.isArray(tracks)) return [];
    const seenKeys = new Set();
    const seenUrls = new Set();
    const albums = [];

    for (const track of tracks) {
      if (!track || !track.imageUrl) continue;
      const key = makeAlbumKey(track.artistName, track.albumName);
      if (seenKeys.has(key) || seenUrls.has(track.imageUrl)) continue;
      seenKeys.add(key);
      seenUrls.add(track.imageUrl);
      albums.push({
        albumName: track.albumName,
        artistName: track.artistName,
        imageUrl: track.imageUrl,
        url: track.trackUrl || null,
      });
    }
    return albums;
  }

  function parseTopAlbums(payload) {
    if (!payload || typeof payload !== 'object' || payload.error) {
      return [];
    }
    const rawAlbums = payload.topalbums && payload.topalbums.album;
    const list = Array.isArray(rawAlbums)
      ? rawAlbums
      : rawAlbums
      ? [rawAlbums]
      : [];
    const albums = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const imageUrl = extractBestImage(raw.image);
      if (!imageUrl) continue;
      const albumName = (raw.name || '').trim() || 'Unknown Album';
      const artistName =
        (raw.artist && (raw.artist.name || raw.artist['#text'])) || 'Unknown Artist';
      albums.push({
        albumName,
        artistName: artistName.trim(),
        imageUrl,
        url: typeof raw.url === 'string' && raw.url ? raw.url : null,
      });
    }
    return albums;
  }

  function mergeAlbumPools(primaryAlbums, secondaryAlbums, maxCount) {
    const merged = [];
    const seenKeys = new Set();
    const seenUrls = new Set();
    const cap = Number.isFinite(maxCount) ? maxCount : 250;

    for (const pool of [primaryAlbums || [], secondaryAlbums || []]) {
      for (const album of pool) {
        if (!album || !album.imageUrl) continue;
        const key = makeAlbumKey(album.artistName, album.albumName);
        if (seenKeys.has(key) || seenUrls.has(album.imageUrl)) continue;
        seenKeys.add(key);
        seenUrls.add(album.imageUrl);
        merged.push(album);
        if (merged.length >= cap) return merged;
      }
    }
    return merged;
  }

  function buildTileAssignments(albums, cols, rows) {
    const safeCols = Math.max(1, Number(cols) || 1);
    const safeRows = Math.max(1, Number(rows) || 1);
    const total = safeCols * safeRows;
    if (!Array.isArray(albums) || albums.length === 0) {
      return [];
    }
    if (albums.length === 1) {
      return Array(total).fill(albums[0]);
    }

    const n = albums.length;
    const grid = new Array(total);
    const centerRow = Math.floor(safeRows / 2);
    const centerCol = Math.floor(safeCols / 2);
    const centerIdx = centerRow * safeCols + centerCol;

    // Reserve index 0 (most recent album) for the center tile so it's always featured
    grid[centerIdx] = 0;

    let cursor = n > 1 ? 1 : 0;
    for (let r = 0; r < safeRows; r += 1) {
      for (let c = 0; c < safeCols; c += 1) {
        const pos = r * safeCols + c;
        if (pos === centerIdx) continue;

        const left = c > 0 ? grid[pos - 1] : -1;
        const up = r > 0 ? grid[pos - safeCols] : -1;
        const right = c + 1 < safeCols && pos + 1 === centerIdx ? grid[centerIdx] : -1;
        const down =
          r + 1 < safeRows && pos + safeCols === centerIdx ? grid[centerIdx] : -1;

        let chosen = cursor % n;
        if (n >= 3) {
          for (let attempt = 0; attempt < n; attempt += 1) {
            const candidate = (cursor + attempt) % n;
            if (
              candidate !== left &&
              candidate !== up &&
              candidate !== right &&
              candidate !== down
            ) {
              chosen = candidate;
              break;
            }
          }
        } else if (n === 2) {
          chosen = (r + c) % 2;
        }

        grid[pos] = chosen;
        cursor = (chosen + 1) % n;
      }
    }

    return grid.map((albumIdx) => albums[albumIdx]);
  }

  function resolveTileTargetSize(
    viewportWidth,
    viewportHeight,
    desktopTargetPx,
    mobilePortraitTargetPx
  ) {
    const safeWidth = Math.max(320, Number(viewportWidth) || 1280);
    const safeHeight = Math.max(240, Number(viewportHeight) || 720);
    const desktopTarget = Math.min(400, Math.max(64, Number(desktopTargetPx) || 140));
    const mobileTarget = Math.min(
      400,
      Math.max(64, Number(mobilePortraitTargetPx) || 80)
    );

    if (safeWidth <= 600 && safeHeight > safeWidth) {
      return mobileTarget;
    }
    return desktopTarget;
  }

  function computeGridDimensions(viewportWidth, viewportHeight, targetSizePx) {
    const safeWidth = Math.max(320, Number(viewportWidth) || 1280);
    const safeHeight = Math.max(240, Number(viewportHeight) || 720);
    const clampedTarget = Math.min(400, Math.max(64, Number(targetSizePx) || 140));
    const minVisibleCols = 4;
    const minVisibleRows = 4;

    let visibleCols = Math.max(minVisibleCols, Math.round(safeWidth / clampedTarget));
    let tileSize = Math.ceil(safeWidth / visibleCols);

    const maxTileForRows = Math.max(1, Math.floor(safeHeight / minVisibleRows));
    if (tileSize > maxTileForRows) {
      visibleCols = Math.max(minVisibleCols, Math.ceil(safeWidth / maxTileForRows));
      tileSize = Math.ceil(safeWidth / visibleCols);
    }

    const visibleRows = Math.max(minVisibleRows, Math.ceil(safeHeight / tileSize));

    const cols = visibleCols + 2;
    const rows = visibleRows + 2;

    return {
      cols,
      rows,
      tileSize,
      totalTiles: cols * rows,
      gridWidth: cols * tileSize,
      gridHeight: rows * tileSize,
    };
  }

  function resolveApiKey(config, searchString, storage) {
    if (typeof searchString === 'string' && searchString) {
      const params = new URLSearchParams(searchString);
      const fromQuery = params.get('apiKey') || params.get('apikey');
      if (fromQuery && fromQuery.trim() && fromQuery.trim() !== 'YOUR_LASTFM_API_KEY') {
        return fromQuery.trim();
      }
    }

    if (storage && typeof storage.getItem === 'function') {
      try {
        const stored = storage.getItem(STORAGE_KEYS.apiKey);
        if (stored && stored.trim() && stored.trim() !== 'YOUR_LASTFM_API_KEY') {
          return stored.trim();
        }
      } catch (_) {
        // Ignore storage errors
      }
    }

    const fromConfig = config && config.lastfmApiKey;
    if (
      typeof fromConfig === 'string' &&
      fromConfig.trim() &&
      fromConfig.trim() !== 'YOUR_LASTFM_API_KEY'
    ) {
      return fromConfig.trim();
    }

    return null;
  }

  function formatRelativeTime(utsSeconds, nowMs) {
    if (!Number.isFinite(utsSeconds)) return 'Last listened';
    const nowSec = Math.floor((nowMs || Date.now()) / 1000);
    const diff = Math.max(0, nowSec - utsSeconds);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    const date = new Date(utsSeconds * 1000);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatStatusLabel(track, statusOverride, nowMs) {
    if (statusOverride) return statusOverride;
    if (!track) return 'NO SCROBBLES';
    if (track.nowPlaying) return 'NOW PLAYING';
    if (!Number.isFinite(track.playedUts)) return 'LAST LISTENED';
    return `LAST LISTENED · ${formatRelativeTime(track.playedUts, nowMs)}`;
  }

  function hashString(input) {
    let hash = 2166136261;
    const str = String(input || 'hellmo.de');
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function escapeXml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildProceduralCoverSvg(albumName, artistName) {
    const seed = hashString(`${artistName}::${albumName}`);
    const hueA = seed % 360;
    const hueB = (hueA + 48 + ((seed >> 8) % 60)) % 360;
    const motif = seed % 3;
    const title = escapeXml((albumName || 'hellmo.de').slice(0, 26));
    const artist = escapeXml((artistName || 'nichbar').slice(0, 26));

    let shapeSvg = `
      <circle cx="200" cy="182" r="112" fill="#09090b" fill-opacity="0.7" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
      <circle cx="200" cy="182" r="76" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
      <circle cx="200" cy="182" r="42" fill="hsl(${hueA}, 58%, 48%)" fill-opacity="0.92"/>
      <circle cx="200" cy="182" r="11" fill="#09090b"/>
    `;
    if (motif === 1) {
      shapeSvg = `
        <rect x="76" y="64" width="248" height="224" rx="18" fill="rgba(9,9,11,0.48)" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
        <circle cx="200" cy="176" r="78" fill="hsl(${hueB}, 68%, 54%)" fill-opacity="0.78"/>
        <circle cx="232" cy="152" r="46" fill="hsl(${hueA}, 72%, 62%)" fill-opacity="0.68"/>
      `;
    } else if (motif === 2) {
      shapeSvg = `
        <polygon points="200,58 314,274 86,274" fill="hsl(${hueB}, 65%, 45%)" fill-opacity="0.72" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
        <circle cx="200" cy="196" r="44" fill="hsl(${hueA}, 72%, 60%)" fill-opacity="0.85"/>
      `;
    }

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="hsl(${hueA}, 55%, 24%)"/>
            <stop offset="100%" stop-color="hsl(${hueB}, 60%, 10%)"/>
          </linearGradient>
          <radialGradient id="shine" cx="30%" cy="25%" r="75%">
            <stop offset="0%" stop-color="hsla(${hueA}, 85%, 70%, 0.28)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
          </radialGradient>
        </defs>
        <rect width="400" height="400" fill="url(#g)"/>
        <rect width="400" height="400" fill="url(#shine)"/>
        ${shapeSvg}
        <text x="24" y="346" fill="rgba(255,255,255,0.92)" font-family="system-ui, sans-serif" font-size="20" font-weight="700">${title}</text>
        <text x="24" y="372" fill="rgba(255,255,255,0.62)" font-family="monospace" font-size="14">${artist}</text>
      </svg>
    `.trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function buildDemoAlbums(count, username, profileUrl) {
    const sampleNames = [
      'Midnight Frequencies',
      'Newtype Echoes',
      'Dalvik Drift',
      'Glass Horizon',
      'Analog Rain',
      'Static Bloom',
      'Northern Signals',
      'Velvet Orbit',
      'Neon Overcast',
      'Tape Loop IV',
      'Subzero Sun',
      'Monochrome Dusk',
      'Amber Telemetry',
      'Night Bus Home',
      'Parallel Lines',
      'Quiet Harbor',
      'Low Tide FM',
      'Silver Static',
      'Paper Satellites',
      'Fading Signal',
      'Winter Tapes',
      'Cold Press',
      'Outer Ring',
      'Cloud Atlas 99',
    ];
    const total = Math.max(1, Math.min(sampleNames.length, Number(count) || 24));
    const albums = [];
    for (let i = 0; i < total; i += 1) {
      const albumName = sampleNames[i];
      const artistName = username || 'nichbar';
      albums.push({
        albumName,
        artistName,
        imageUrl: buildProceduralCoverSvg(albumName, `${artistName} · #${i + 1}`),
        url: profileUrl || null,
      });
    }
    return albums;
  }

  function parseStaticSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { primary: null, albums: [], updatedAt: null };
    }
    const primary =
      snapshot.primary && typeof snapshot.primary === 'object'
        ? {
            trackName: snapshot.primary.trackName || 'Unknown Track',
            artistName: snapshot.primary.artistName || 'Unknown Artist',
            albumName: snapshot.primary.albumName || 'Unknown Album',
            nowPlaying: Boolean(snapshot.primary.nowPlaying),
            playedUts: Number.isFinite(snapshot.primary.playedUts)
              ? snapshot.primary.playedUts
              : null,
            trackUrl: snapshot.primary.trackUrl || null,
            imageUrl: normalizeImageUrl(snapshot.primary.imageUrl),
          }
        : null;

    const rawAlbums = Array.isArray(snapshot.albums) ? snapshot.albums : [];
    const albums = rawAlbums
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const imageUrl = normalizeImageUrl(item.imageUrl);
        if (!imageUrl) return null;
        return {
          albumName: item.albumName || 'Unknown Album',
          artistName: item.artistName || 'Unknown Artist',
          imageUrl,
          url: item.url || null,
        };
      })
      .filter(Boolean);

    return {
      primary,
      albums,
      updatedAt: typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : null,
    };
  }

  function getCandidateLineIndices(lineCount, excludedIndex) {
    const hasOverscan = lineCount >= 4;
    const minIdx = hasOverscan ? 1 : 0;
    const maxExclusive = hasOverscan ? lineCount - 1 : lineCount;
    const all = [];
    for (let i = minIdx; i < maxExclusive; i += 1) {
      all.push(i);
    }
    if (!Number.isFinite(excludedIndex)) {
      return { preferred: all, fallback: all };
    }
    const preferred = all.filter((idx) => Math.abs(idx - excludedIndex) > 1);
    return { preferred, fallback: all };
  }

  function pickRandomLineSlide(rows, cols, rng, lastSlide) {
    const safeRows = Math.max(1, Number(rows) || 1);
    const safeCols = Math.max(1, Number(cols) || 1);
    const rand = typeof rng === 'function' ? rng : Math.random;

    if (safeRows <= 1 && safeCols <= 1) {
      return { axis: 'row', index: 0, delta: 0 };
    }

    const canPickRow = safeCols > 1;
    const canPickCol = safeRows > 1;
    const excludedRow =
      lastSlide && lastSlide.axis === 'row' ? lastSlide.index : NaN;
    const excludedCol =
      lastSlide && lastSlide.axis === 'col' ? lastSlide.index : NaN;

    const rowCandidates = canPickRow
      ? getCandidateLineIndices(safeRows, excludedRow)
      : { preferred: [], fallback: [] };
    const colCandidates = canPickCol
      ? getCandidateLineIndices(safeCols, excludedCol)
      : { preferred: [], fallback: [] };

    let axis;
    if (!canPickCol) {
      axis = 'row';
    } else if (!canPickRow) {
      axis = 'col';
    } else if (
      rowCandidates.preferred.length > 0 &&
      colCandidates.preferred.length > 0
    ) {
      axis = rand() < 0.5 ? 'row' : 'col';
    } else if (rowCandidates.preferred.length > 0) {
      axis = 'row';
    } else if (colCandidates.preferred.length > 0) {
      axis = 'col';
    } else {
      axis = rand() < 0.5 ? 'row' : 'col';
    }

    const info = axis === 'row' ? rowCandidates : colCandidates;
    const pool = info.preferred.length > 0 ? info.preferred : info.fallback;
    const index = pool[Math.floor(rand() * pool.length)] ?? 0;

    const lineLength = axis === 'row' ? safeCols : safeRows;
    const maxStep = Math.max(1, Math.min(2, lineLength - 1));
    const magnitude = maxStep >= 2 && rand() >= 0.72 ? 2 : 1;
    return {
      axis,
      index,
      delta: magnitude,
    };
  }

  function stepGridMatrix(matrix, axis, lineIndex, delta) {
    if (!Array.isArray(matrix) || matrix.length === 0) return [];
    const rows = matrix.length;
    const cols = Array.isArray(matrix[0]) ? matrix[0].length : 0;
    if (cols === 0) return matrix.map((row) => [...row]);

    const next = matrix.map((row) => [...row]);
    const steps = Number(delta) || 0;
    if (steps === 0) return next;

    if (axis === 'row') {
      const r = ((lineIndex % rows) + rows) % rows;
      const shift = ((steps % cols) + cols) % cols;
      for (let c = 0; c < cols; c += 1) {
        const targetCol = (c + shift) % cols;
        next[r][targetCol] = matrix[r][c];
      }
    } else if (axis === 'col') {
      const c = ((lineIndex % cols) + cols) % cols;
      const shift = ((steps % rows) + rows) % rows;
      for (let r = 0; r < rows; r += 1) {
        const targetRow = (r + shift) % rows;
        next[targetRow][c] = matrix[r][c];
      }
    }

    return next;
  }

  function buildTileMatrix(albums, cols, rows) {
    const flat = buildTileAssignments(albums, cols, rows);
    const safeCols = Math.max(1, Number(cols) || 1);
    const safeRows = Math.max(1, Number(rows) || 1);
    if (flat.length === 0) return [];
    const matrix = [];
    for (let r = 0; r < safeRows; r += 1) {
      matrix.push(flat.slice(r * safeCols, (r + 1) * safeCols));
    }
    return matrix;
  }

  const exported = {
    LASTFM_PLACEHOLDER_HASH,
    isValidAlbumArtUrl,
    normalizeImageUrl,
    extractBestImage,
    parseRecentTracks,
    extractUniqueAlbums,
    parseTopAlbums,
    mergeAlbumPools,
    buildTileAssignments,
    buildTileMatrix,
    stepGridMatrix,
    pickRandomLineSlide,
    resolveTileTargetSize,
    computeGridDimensions,
    resolveApiKey,
    formatRelativeTime,
    formatStatusLabel,
    buildProceduralCoverSvg,
    buildDemoAlbums,
    parseStaticSnapshot,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  // =========================================================================
  // Browser Application
  // =========================================================================

  const config = Object.assign(
    {
      siteDomain: 'hellmo.de',
      lastfmUsername: 'nichbar',
      dataUrl: 'data/lastfm.json',
      lastfmApiKey: '',
      lastfmProfileUrl: 'https://www.last.fm/user/nichbar',
      githubUsername: 'nichbar',
      githubUrl: 'https://www.github.com/nichbar',
      pollIntervalMs: 300000,
      tileTargetSizePx: 140,
      mobileTileTargetSizePx: 80,
      ambientDrift: true,
    },
    global.HELLMO_CONFIG || {}
  );

  const els = {
    stage: document.getElementById('wallpaper-stage'),
    backdrop: document.getElementById('ambient-backdrop'),
    gridA: document.getElementById('wallpaper-grid-a'),
    gridB: document.getElementById('wallpaper-grid-b'),
    favicon: document.getElementById('dynamic-favicon'),
    hudContainer: document.getElementById('hud-container'),
    hudCover: document.getElementById('hud-cover'),
    hudCoverLink: document.getElementById('hud-cover-link'),
    hudStatusDot: document.getElementById('hud-status-dot'),
    hudStatusLabel: document.getElementById('hud-status-label'),
    hudTrack: document.getElementById('hud-track'),
    hudMeta: document.getElementById('hud-meta'),
    hudLastfmLink: document.getElementById('hud-lastfm-link'),
    btnSmaller: document.getElementById('btn-tile-smaller'),
    btnLarger: document.getElementById('btn-tile-larger'),
    btnMotion: document.getElementById('btn-toggle-motion'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnHideHud: document.getElementById('btn-hide-hud'),
    hudRestoreBtn: document.getElementById('hud-restore-btn'),
    ghAvatar: document.getElementById('gh-avatar'),
    ghName: document.getElementById('gh-name'),
    ghHandle: document.getElementById('gh-handle'),
    ghBio: document.getElementById('gh-bio'),
    ghMeta: document.getElementById('gh-meta'),
    ghLink: document.getElementById('hud-github-link'),
  };

  function readOptionalNumberStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === '') return null;
      const val = Number.parseInt(raw, 10);
      return Number.isFinite(val) ? val : null;
    } catch (_) {
      return null;
    }
  }

  function readBoolStorage(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      if (val === 'true') return true;
      if (val === 'false') return false;
      return fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {
      // Ignore
    }
  }

  const SLIDE_INITIAL_DELAY_MS = 650;
  const SLIDE_INTERVAL_MS = 2200;
  const SLIDE_DURATION_MS = 1400;
  const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

  const state = {
    apiKey: resolveApiKey(config, window.location.search, window.localStorage),
    activeGridKey: 'a',
    wallSignature: null,
    currentAlbums: [],
    currentPrimaryAlbum: null,
    cachedTopAlbums: null,
    cachedTopAlbumsAt: 0,
    customTileTargetSizePx: readOptionalNumberStorage(STORAGE_KEYS.tileSize),
    ambientDrift: readBoolStorage(STORAGE_KEYS.motion, config.ambientDrift),
    hudHidden: readBoolStorage(STORAGE_KEYS.hudHidden, false),
    pollTimerId: null,
    slideInitialTimerId: null,
    slideTimerId: null,
    slideFinishTimerId: null,
    slideRaf1Id: null,
    slideRaf2Id: null,
    slideGeneration: 0,
    pendingExitingTiles: [],
    pendingMovingTiles: [],
    pendingTileTargets: [],
    isSliding: false,
    lastSlide: null,
    gridBoards: {
      a: null,
      b: null,
    },
    lastTrack: null,
  };

  function applyMotionState() {
    els.stage.classList.toggle('is-drifting', state.ambientDrift);
    els.btnMotion.classList.toggle('is-pressed', state.ambientDrift);
    els.btnMotion.setAttribute('aria-pressed', String(state.ambientDrift));
    if (state.ambientDrift) {
      startSlideLoop();
    } else {
      stopSlideLoop();
    }
  }

  function applyHudVisibility() {
    els.hudContainer.classList.toggle('is-hidden', state.hudHidden);
    els.hudRestoreBtn.hidden = !state.hudHidden;
  }

  function createTileElement(album, row, col, tileSize) {
    const tile = document.createElement('div');
    tile.className = 'wall-tile';
    tile.style.transform = `translate3d(${col * tileSize}px, ${row * tileSize}px, 0)`;

    const img = document.createElement('img');
    img.src = album.imageUrl;
    img.alt = `${album.albumName} by ${album.artistName}`;
    img.decoding = 'async';
    img.draggable = false;

    tile.appendChild(img);
    return tile;
  }

  function getEffectiveTileTargetSize() {
    if (Number.isFinite(state.customTileTargetSizePx)) {
      return state.customTileTargetSizePx;
    }
    return resolveTileTargetSize(
      window.innerWidth,
      window.innerHeight,
      config.tileTargetSizePx,
      config.mobileTileTargetSizePx
    );
  }

  function populateGrid(gridEl, gridKey, albums) {
    const dims = computeGridDimensions(
      window.innerWidth,
      window.innerHeight,
      getEffectiveTileTargetSize()
    );
    const tileMatrix = buildTileMatrix(albums, dims.cols, dims.rows);

    document.documentElement.style.setProperty('--tile-size', `${dims.tileSize}px`);
    gridEl.style.width = `${dims.gridWidth}px`;
    gridEl.style.height = `${dims.gridHeight}px`;

    const domMatrix = [];
    const fragment = document.createDocumentFragment();
    for (let r = 0; r < dims.rows; r += 1) {
      const domRow = [];
      for (let c = 0; c < dims.cols; c += 1) {
        const album = tileMatrix[r][c];
        const tile = createTileElement(album, r, c, dims.tileSize);
        domRow.push(tile);
        fragment.appendChild(tile);
      }
      domMatrix.push(domRow);
    }

    gridEl.replaceChildren(fragment);
    state.lastSlide = null;
    state.gridBoards[gridKey] = {
      dims,
      domMatrix,
      albumMatrix: tileMatrix,
    };
  }

  function stopSlideLoop() {
    state.slideGeneration += 1;
    if (state.slideInitialTimerId !== null) {
      clearTimeout(state.slideInitialTimerId);
      state.slideInitialTimerId = null;
    }
    if (state.slideTimerId !== null) {
      clearInterval(state.slideTimerId);
      state.slideTimerId = null;
    }
    if (state.slideFinishTimerId !== null) {
      clearTimeout(state.slideFinishTimerId);
      state.slideFinishTimerId = null;
    }
    if (state.slideRaf1Id !== null) {
      cancelAnimationFrame(state.slideRaf1Id);
      state.slideRaf1Id = null;
    }
    if (state.slideRaf2Id !== null) {
      cancelAnimationFrame(state.slideRaf2Id);
      state.slideRaf2Id = null;
    }
    if (state.pendingTileTargets.length > 0) {
      for (const item of state.pendingTileTargets) {
        item.tile.classList.add('is-instant');
        item.tile.style.transform = item.transform;
      }
      state.pendingTileTargets = [];
    }
    if (state.pendingExitingTiles.length > 0) {
      for (const tile of state.pendingExitingTiles) {
        tile.remove();
      }
      state.pendingExitingTiles = [];
    }
    if (state.pendingMovingTiles.length > 0) {
      for (const tile of state.pendingMovingTiles) {
        tile.classList.remove('is-sliding', 'is-instant');
      }
      state.pendingMovingTiles = [];
    }
    state.isSliding = false;
  }

  function startSlideLoop() {
    stopSlideLoop();
    if (!state.ambientDrift) return;
    state.slideInitialTimerId = window.setTimeout(() => {
      state.slideInitialTimerId = null;
      if (!document.hidden) {
        performRandomLineSlide();
      }
      state.slideTimerId = window.setInterval(() => {
        if (!document.hidden) {
          performRandomLineSlide();
        }
      }, SLIDE_INTERVAL_MS);
    }, SLIDE_INITIAL_DELAY_MS);
  }

  function performRandomLineSlide() {
    if (!state.ambientDrift || state.isSliding) return;
    const board = state.gridBoards[state.activeGridKey];
    if (!board || !board.domMatrix || board.domMatrix.length === 0) return;

    const { rows, cols, tileSize } = board.dims;
    if (rows < 2 || cols < 2) return;

    const move = pickRandomLineSlide(rows, cols, undefined, state.lastSlide);
    if (!move || move.delta === 0) return;

    const lineLength = move.axis === 'row' ? cols : rows;
    const clampedDelta =
      Math.sign(move.delta) * Math.min(lineLength - 1, Math.abs(move.delta));
    if (clampedDelta === 0) return;

    state.lastSlide = { axis: move.axis, index: move.index };
    state.isSliding = true;
    const generation = state.slideGeneration;

    const gridEl = state.activeGridKey === 'a' ? els.gridA : els.gridB;
    const nextDomMatrix = board.domMatrix.map((row) => [...row]);
    const nextAlbumMatrix = stepGridMatrix(
      board.albumMatrix,
      move.axis,
      move.index,
      clampedDelta
    );

    const movingTiles = [];
    const enteringTiles = [];
    const exitingTiles = [];
    const absDelta = Math.abs(clampedDelta);

    if (move.axis === 'row') {
      const r = move.index;

      for (let c = 0; c < cols; c += 1) {
        const tile = board.domMatrix[r][c];
        const targetCol = c + clampedDelta;
        tile.classList.add('is-sliding');
        movingTiles.push({
          tile,
          transform: `translate3d(${targetCol * tileSize}px, ${r * tileSize}px, 0)`,
        });

        if (targetCol < 0 || targetCol >= cols) {
          exitingTiles.push(tile);
        } else {
          nextDomMatrix[r][targetCol] = tile;
        }
      }

      for (let step = 0; step < absDelta; step += 1) {
        const startCol = clampedDelta > 0 ? -absDelta + step : cols + step;
        const finalCol = ((startCol + clampedDelta) % cols + cols) % cols;
        const sourceCol = ((finalCol - clampedDelta) % cols + cols) % cols;
        const album = board.albumMatrix[r][sourceCol];
        const clone = createTileElement(album, r, startCol, tileSize);
        clone.classList.add('is-instant', 'is-sliding');
        gridEl.appendChild(clone);
        enteringTiles.push({
          tile: clone,
          transform: `translate3d(${finalCol * tileSize}px, ${r * tileSize}px, 0)`,
        });
        nextDomMatrix[r][finalCol] = clone;
      }
    } else {
      const c = move.index;

      for (let r = 0; r < rows; r += 1) {
        const tile = board.domMatrix[r][c];
        const targetRow = r + clampedDelta;
        tile.classList.add('is-sliding');
        movingTiles.push({
          tile,
          transform: `translate3d(${c * tileSize}px, ${targetRow * tileSize}px, 0)`,
        });

        if (targetRow < 0 || targetRow >= rows) {
          exitingTiles.push(tile);
        } else {
          nextDomMatrix[targetRow][c] = tile;
        }
      }

      for (let step = 0; step < absDelta; step += 1) {
        const startRow = clampedDelta > 0 ? -absDelta + step : rows + step;
        const finalRow = ((startRow + clampedDelta) % rows + rows) % rows;
        const sourceRow = ((finalRow - clampedDelta) % rows + rows) % rows;
        const album = board.albumMatrix[sourceRow][c];
        const clone = createTileElement(album, startRow, c, tileSize);
        clone.classList.add('is-instant', 'is-sliding');
        gridEl.appendChild(clone);
        enteringTiles.push({
          tile: clone,
          transform: `translate3d(${c * tileSize}px, ${finalRow * tileSize}px, 0)`,
        });
        nextDomMatrix[finalRow][c] = clone;
      }
    }

    board.domMatrix = nextDomMatrix;
    board.albumMatrix = nextAlbumMatrix;
    state.pendingExitingTiles = exitingTiles;
    state.pendingTileTargets = [...movingTiles, ...enteringTiles];
    state.pendingMovingTiles = state.pendingTileTargets.map((item) => item.tile);

    const finishSlide = () => {
      if (generation !== state.slideGeneration) return;
      for (const tile of exitingTiles) {
        tile.remove();
      }
      for (const tile of state.pendingMovingTiles) {
        tile.classList.remove('is-sliding', 'is-instant');
      }
      state.pendingExitingTiles = [];
      state.pendingMovingTiles = [];
      state.pendingTileTargets = [];
      state.isSliding = false;
      state.slideFinishTimerId = null;
    };

    // Safety fallback in case the browser throttles animation frames
    state.slideFinishTimerId = window.setTimeout(
      finishSlide,
      SLIDE_DURATION_MS + 400
    );

    // Commit initial off-edge clone coordinates on frame 0, enable CSS transition on frame 1,
    // and apply target transforms to all sliding tiles together on frame 2 (reliable on iOS WebKit).
    void gridEl.offsetWidth;
    state.slideRaf1Id = window.requestAnimationFrame(() => {
      state.slideRaf1Id = null;
      if (generation !== state.slideGeneration) return;
      for (const item of enteringTiles) {
        item.tile.classList.remove('is-instant');
      }
      void gridEl.offsetWidth;

      state.slideRaf2Id = window.requestAnimationFrame(() => {
        state.slideRaf2Id = null;
        if (generation !== state.slideGeneration) return;
        for (const item of movingTiles) {
          item.tile.style.transform = item.transform;
        }
        for (const item of enteringTiles) {
          item.tile.style.transform = item.transform;
        }
        clearTimeout(state.slideFinishTimerId);
        state.slideFinishTimerId = window.setTimeout(
          finishSlide,
          SLIDE_DURATION_MS + 60
        );
      });
    });
  }

  function preloadImage(url, timeoutMs) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, timeoutMs || 4000);

      img.onload = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(true);
        }
      };
      img.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      };
      img.src = url;
    });
  }

  function updateAccentFromCover(imageUrl) {
    if (!imageUrl || imageUrl.startsWith('data:image/svg+xml')) {
      return;
    }
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(probe, 0, 0, 16, 16);
        const { data } = ctx.getImageData(0, 0, 16, 16);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          if (max > 35 && min < 230) {
            r += pr;
            g += pg;
            b += pb;
            count += 1;
          }
        }
        if (count > 0) {
          const ar = Math.round(r / count);
          const ag = Math.round(g / count);
          const ab = Math.round(b / count);
          document.documentElement.style.setProperty(
            '--accent',
            `rgb(${ar}, ${ag}, ${ab})`
          );
          document.documentElement.style.setProperty(
            '--accent-rgb',
            `${ar}, ${ag}, ${ab}`
          );
        }
      } catch (_) {
        // Ignore tainted canvas if CDN lacks CORS headers
      }
    };
    probe.src = imageUrl;
  }

  async function renderWallpaperWall(albums, primaryAlbum, forceRedraw) {
    if (!Array.isArray(albums) || albums.length === 0) return;

    const lead = primaryAlbum || albums[0];
    const nextSignature = `${lead.imageUrl}::${albums
      .slice(0, 48)
      .map((a) => a.imageUrl)
      .join('|')}`;
    const wallChanged = nextSignature !== state.wallSignature;

    if (!wallChanged && !forceRedraw) {
      return;
    }

    state.wallSignature = nextSignature;
    state.currentAlbums = albums;
    state.currentPrimaryAlbum = lead;

    els.backdrop.style.backgroundImage = `url("${lead.imageUrl.replace(
      /"/g,
      '%22'
    )}")`;
    els.hudCover.src = lead.imageUrl;
    els.hudCover.alt = `${lead.albumName} by ${lead.artistName}`;
    if (els.favicon) {
      els.favicon.href = lead.imageUrl;
    }

    if (wallChanged) {
      updateAccentFromCover(lead.imageUrl);
      await Promise.all(
        albums.slice(0, 8).map((album) => preloadImage(album.imageUrl, 3000))
      );

      stopSlideLoop();
      const nextKey = state.activeGridKey === 'a' ? 'b' : 'a';
      const incoming = nextKey === 'a' ? els.gridA : els.gridB;
      const outgoing = nextKey === 'a' ? els.gridB : els.gridA;

      populateGrid(incoming, nextKey, albums);
      void incoming.offsetWidth;
      incoming.classList.add('is-active');
      outgoing.classList.remove('is-active');
      state.activeGridKey = nextKey;
      startSlideLoop();
    } else {
      stopSlideLoop();
      const activeGrid = state.activeGridKey === 'a' ? els.gridA : els.gridB;
      populateGrid(activeGrid, state.activeGridKey, albums);
      startSlideLoop();
    }
  }

  async function fetchAlbumCoverFallback(artistName, albumName, apiKey) {
    if (!artistName || !albumName || !apiKey) return null;
    const params = new URLSearchParams({
      method: 'album.getinfo',
      artist: artistName,
      album: albumName,
      api_key: apiKey,
      format: 'json',
      autocorrect: '1',
    });
    try {
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json();
      return extractBestImage(data && data.album && data.album.image);
    } catch (_) {
      return null;
    }
  }

  async function fetchTopAlbumsPool(apiKey) {
    const tenMinutes = 10 * 60 * 1000;
    if (
      state.cachedTopAlbums &&
      Date.now() - state.cachedTopAlbumsAt < tenMinutes
    ) {
      return state.cachedTopAlbums;
    }

    const params = new URLSearchParams({
      method: 'user.gettopalbums',
      user: config.lastfmUsername,
      api_key: apiKey,
      format: 'json',
      limit: '300',
    });
    try {
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`);
      if (!res.ok) return [];
      const payload = await res.json();
      const parsed = parseTopAlbums(payload);
      state.cachedTopAlbums = parsed;
      state.cachedTopAlbumsAt = Date.now();
      return parsed;
    } catch (_) {
      return [];
    }
  }

  function updateMusicHud(track, statusOverride) {
    if (!track) {
      els.hudStatusDot.classList.remove('is-live');
      els.hudStatusLabel.textContent = statusOverride || 'NO SCROBBLES';
      els.hudTrack.textContent = 'No recent scrobbles found';
      els.hudMeta.textContent = config.lastfmUsername;
      return;
    }

    els.hudStatusDot.classList.toggle('is-live', Boolean(track.nowPlaying));
    els.hudStatusLabel.textContent = formatStatusLabel(track, statusOverride);

    els.hudTrack.textContent = track.trackName;
    els.hudMeta.textContent =
      track.albumName && track.albumName !== track.trackName
        ? `${track.artistName} — ${track.albumName}`
        : track.artistName;

    const targetHref = track.trackUrl || config.lastfmProfileUrl;
    els.hudCoverLink.href = targetHref;
  }

  async function refreshFromStaticSnapshot() {
    const dataUrl = config.dataUrl || 'data/lastfm.json';
    try {
      const res = await fetch(dataUrl, { cache: 'no-cache' });
      if (!res.ok) {
        throw new Error(`Snapshot HTTP ${res.status}`);
      }
      const raw = await res.json();
      const { primary, albums } = parseStaticSnapshot(raw);

      if (!primary && albums.length === 0) {
        const demoAlbums = buildDemoAlbums(
          24,
          config.lastfmUsername,
          config.lastfmProfileUrl
        );
        updateMusicHud(
          {
            trackName: 'Awaiting first Last.fm sync',
            artistName: config.lastfmUsername,
            albumName: 'Runs every 6h via GitHub Actions',
            nowPlaying: false,
            trackUrl: config.lastfmProfileUrl,
          },
          'AWAITING SYNC'
        );
        await renderWallpaperWall(demoAlbums, demoAlbums[0], false);
        return;
      }

      state.lastTrack = primary;
      const primaryCoverUrl =
        (primary && primary.imageUrl) ||
        (albums[0] && albums[0].imageUrl) ||
        buildProceduralCoverSvg(
          (primary && primary.albumName) || 'hellmo.de',
          (primary && primary.artistName) || config.lastfmUsername
        );

      const primaryAlbum = primary
        ? {
            albumName: primary.albumName,
            artistName: primary.artistName,
            imageUrl: primaryCoverUrl,
            url: primary.trackUrl || config.lastfmProfileUrl,
          }
        : albums[0];

      const wallAlbums = mergeAlbumPools([primaryAlbum], albums, 250);
      updateMusicHud(primary);
      await renderWallpaperWall(wallAlbums, primaryAlbum, false);
    } catch (err) {
      console.error('Failed to load Last.fm snapshot:', err);
      if (state.currentAlbums.length === 0) {
        const fallbackAlbums = buildDemoAlbums(
          18,
          config.lastfmUsername,
          config.lastfmProfileUrl
        );
        await renderWallpaperWall(fallbackAlbums, fallbackAlbums[0], false);
      }
      els.hudStatusDot.classList.remove('is-live');
      els.hudStatusLabel.textContent = 'OFFLINE';
      if (!state.lastTrack) {
        els.hudTrack.textContent = 'Unable to load Last.fm snapshot';
        els.hudMeta.textContent = config.lastfmProfileUrl;
      }
    }
  }

  async function refreshLastfm() {
    if (!state.apiKey) {
      await refreshFromStaticSnapshot();
      return;
    }

    const params = new URLSearchParams({
      method: 'user.getrecenttracks',
      user: config.lastfmUsername,
      api_key: state.apiKey,
      format: 'json',
      limit: '200',
    });

    try {
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`);
      const payload = await res.json();
      const { primary, tracks } = parseRecentTracks(payload);

      if (!primary) {
        updateMusicHud(null, 'EMPTY');
        const fallbackAlbums = buildDemoAlbums(
          16,
          config.lastfmUsername,
          config.lastfmProfileUrl
        );
        await renderWallpaperWall(fallbackAlbums, fallbackAlbums[0], false);
        return;
      }

      state.lastTrack = primary;
      let primaryCoverUrl = primary.imageUrl;

      if (!primaryCoverUrl) {
        primaryCoverUrl = await fetchAlbumCoverFallback(
          primary.artistName,
          primary.albumName,
          state.apiKey
        );
      }

      if (!primaryCoverUrl) {
        primaryCoverUrl = buildProceduralCoverSvg(
          primary.albumName,
          primary.artistName
        );
      }

      const primaryAlbum = {
        albumName: primary.albumName,
        artistName: primary.artistName,
        imageUrl: primaryCoverUrl,
        url: primary.trackUrl || config.lastfmProfileUrl,
      };

      const recentAlbums = extractUniqueAlbums(tracks);
      const dims = computeGridDimensions(
        window.innerWidth,
        window.innerHeight,
        getEffectiveTileTargetSize()
      );

      let albumPool = mergeAlbumPools([primaryAlbum], recentAlbums, 250);
      if (albumPool.length < 250) {
        const topAlbums = await fetchTopAlbumsPool(state.apiKey);
        albumPool = mergeAlbumPools(albumPool, topAlbums, 250);
      }

      updateMusicHud(primary);
      await renderWallpaperWall(albumPool, primaryAlbum, false);
    } catch (err) {
      console.error('Last.fm refresh failed:', err);
      const isInvalidKey = err && (err.code === 10 || err.code === 26);
      if (state.currentAlbums.length === 0) {
        const fallbackAlbums = buildDemoAlbums(
          18,
          config.lastfmUsername,
          config.lastfmProfileUrl
        );
        await renderWallpaperWall(fallbackAlbums, fallbackAlbums[0], false);
      }
      els.hudStatusDot.classList.remove('is-live');
      els.hudStatusLabel.textContent = isInvalidKey ? 'INVALID API KEY' : 'OFFLINE';
      if (!state.lastTrack) {
        els.hudTrack.textContent = isInvalidKey
          ? 'Invalid Last.fm API key'
          : 'Unable to reach Last.fm';
        els.hudMeta.textContent = config.lastfmProfileUrl;
      }
    }
  }

  async function hydrateGitHubProfile() {
    if (els.ghLink) els.ghLink.href = config.githubUrl;
    if (els.hudLastfmLink) els.hudLastfmLink.href = config.lastfmProfileUrl;

    if (!els.ghAvatar && !els.ghName && !els.ghHandle && !els.ghBio && !els.ghMeta) {
      return;
    }

    const cacheKey = `hellmo_gh_profile_${config.githubUsername}`;
    let profile = null;

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Date.now() - parsed.cachedAt < 15 * 60 * 1000) {
          profile = parsed.data;
        }
      }
    } catch (_) {
      // Ignore
    }

    if (!profile) {
      try {
        const res = await fetch(
          `https://api.github.com/users/${encodeURIComponent(config.githubUsername)}`
        );
        if (res.ok) {
          profile = await res.json();
          try {
            sessionStorage.setItem(
              cacheKey,
              JSON.stringify({ cachedAt: Date.now(), data: profile })
            );
          } catch (_) {
            // Ignore
          }
        }
      } catch (_) {
        // Ignore network errors and keep static HTML fallback
      }
    }

    if (!profile) return;

    if (profile.avatar_url && els.ghAvatar) els.ghAvatar.src = profile.avatar_url;
    if ((profile.name || profile.login) && els.ghName) {
      els.ghName.textContent = profile.name || profile.login;
    }
    if (profile.login && els.ghHandle) {
      els.ghHandle.textContent = `@${profile.login}`;
    }
    if (profile.bio && els.ghBio) {
      els.ghBio.textContent = profile.bio;
    }
    const metaParts = [];
    if (profile.location) metaParts.push(profile.location);
    if (typeof profile.public_repos === 'number') {
      metaParts.push(`${profile.public_repos} repos`);
    }
    if (metaParts.length > 0 && els.ghMeta) {
      els.ghMeta.textContent = metaParts.join(' · ');
    }
  }

  function startPolling() {
    stopPolling();
    const interval = Math.max(10000, Number(config.pollIntervalMs) || 30000);
    state.pollTimerId = window.setInterval(() => {
      if (!document.hidden) {
        refreshLastfm();
      }
    }, interval);
  }

  function stopPolling() {
    if (state.pollTimerId !== null) {
      clearInterval(state.pollTimerId);
      state.pollTimerId = null;
    }
  }

  function bindEvents() {
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.currentAlbums.length === 0) return;
        const board = state.gridBoards[state.activeGridKey];
        const nextDims = computeGridDimensions(
          window.innerWidth,
          window.innerHeight,
          getEffectiveTileTargetSize()
        );
        if (
          board &&
          board.dims.cols === nextDims.cols &&
          board.dims.rows === nextDims.rows &&
          board.dims.tileSize === nextDims.tileSize
        ) {
          return;
        }
        renderWallpaperWall(state.currentAlbums, state.currentPrimaryAlbum, true);
      }, 120);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopSlideLoop();
      } else {
        if (state.ambientDrift) {
          startSlideLoop();
        }
        refreshLastfm();
      }
    });

    els.btnSmaller.addEventListener('click', () => {
      const currentSize = getEffectiveTileTargetSize();
      state.customTileTargetSizePx = Math.max(64, currentSize - 30);
      writeStorage(STORAGE_KEYS.tileSize, state.customTileTargetSizePx);
      if (state.currentAlbums.length > 0) {
        renderWallpaperWall(state.currentAlbums, state.currentPrimaryAlbum, true);
      }
    });

    els.btnLarger.addEventListener('click', () => {
      const currentSize = getEffectiveTileTargetSize();
      state.customTileTargetSizePx = Math.min(380, currentSize + 30);
      writeStorage(STORAGE_KEYS.tileSize, state.customTileTargetSizePx);
      if (state.currentAlbums.length > 0) {
        renderWallpaperWall(state.currentAlbums, state.currentPrimaryAlbum, true);
      }
    });

    els.btnMotion.addEventListener('click', () => {
      state.ambientDrift = !state.ambientDrift;
      writeStorage(STORAGE_KEYS.motion, state.ambientDrift);
      applyMotionState();
    });

    els.btnRefresh.addEventListener('click', () => {
      refreshLastfm();
    });

    function toggleHud(forceHidden) {
      state.hudHidden =
        typeof forceHidden === 'boolean' ? forceHidden : !state.hudHidden;
      writeStorage(STORAGE_KEYS.hudHidden, state.hudHidden);
      applyHudVisibility();
    }

    els.btnHideHud.addEventListener('click', () => toggleHud(true));
    els.hudRestoreBtn.addEventListener('click', () => toggleHud(false));

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isTyping) return;

      if (event.key === 'h' || event.key === 'H') {
        toggleHud();
      }
    });
  }

  function init() {
    applyMotionState();
    applyHudVisibility();
    bindEvents();
    hydrateGitHubProfile();
    refreshLastfm();
    startPolling();
  }

  init();
})(typeof window !== 'undefined' ? window : globalThis);
