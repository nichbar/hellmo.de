import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildLastfmSnapshot } from '../scripts/fetch-lastfm.mjs';

const require = createRequire(import.meta.url);
const config = require('../config.js');
const app = require('../app.js');

test('config.js defines expected domain, snapshot path, and profile defaults', () => {
  assert.equal(config.siteDomain, 'hellmo.de');
  assert.equal(config.lastfmUsername, 'nichbar');
  assert.equal(config.dataUrl, 'data/lastfm.json');
  assert.equal(config.githubUsername, 'nichbar');
  assert.equal(config.githubUrl, 'https://www.github.com/nichbar');
  assert.equal(config.lastfmProfileUrl, 'https://www.last.fm/user/nichbar');
  assert.equal(config.tileTargetSizePx, 140);
  assert.equal('lastfmApiKey' in config, false);
});

test('isValidAlbumArtUrl rejects empty strings and Last.fm default star placeholder', () => {
  assert.equal(app.isValidAlbumArtUrl(''), false);
  assert.equal(app.isValidAlbumArtUrl(null), false);
  assert.equal(
    app.isValidAlbumArtUrl(
      'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'
    ),
    false
  );
  assert.equal(
    app.isValidAlbumArtUrl(
      'https://lastfm.freetls.fastly.net/i/u/300x300/abcdef1234567890.jpg'
    ),
    true
  );
});

test('extractBestImage prefers extralarge and upgrades http to https', () => {
  const url = app.extractBestImage([
    { size: 'small', '#text': 'http://img.example/small.jpg' },
    { size: 'large', '#text': 'http://img.example/large.jpg' },
    { size: 'extralarge', '#text': 'http://img.example/xl.jpg' },
  ]);
  assert.equal(url, 'https://img.example/xl.jpg');
});

test('extractBestImage skips placeholder images and falls back to valid sizes', () => {
  const url = app.extractBestImage([
    {
      size: 'extralarge',
      '#text':
        'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png',
    },
    { size: 'medium', '#text': 'https://img.example/medium.jpg' },
  ]);
  assert.equal(url, 'https://img.example/medium.jpg');
});

test('parseRecentTracks handles array and single-object responses', () => {
  const singlePayload = {
    recenttracks: {
      track: {
        name: 'Track One',
        artist: { '#text': 'Artist A' },
        album: { '#text': 'Album X' },
        url: 'https://www.last.fm/music/Artist+A/_/Track+One',
        '@attr': { nowplaying: 'true' },
        image: [{ size: 'extralarge', '#text': 'https://img.example/a.jpg' }],
      },
    },
  };

  const single = app.parseRecentTracks(singlePayload);
  assert.equal(single.tracks.length, 1);
  assert.equal(single.primary.trackName, 'Track One');
  assert.equal(single.primary.artistName, 'Artist A');
  assert.equal(single.primary.albumName, 'Album X');
  assert.equal(single.primary.nowPlaying, true);
  assert.equal(single.primary.imageUrl, 'https://img.example/a.jpg');
});

test('extractUniqueAlbums deduplicates by album key and image URL while keeping order', () => {
  const albums = app.extractUniqueAlbums([
    {
      albumName: 'Album 1',
      artistName: 'Artist A',
      imageUrl: 'https://img.example/1.jpg',
      trackUrl: 'https://last.fm/1',
    },
    {
      albumName: 'Album 1',
      artistName: 'Artist A',
      imageUrl: 'https://img.example/1.jpg',
      trackUrl: 'https://last.fm/2',
    },
    {
      albumName: 'Album 2',
      artistName: 'Artist B',
      imageUrl: 'https://img.example/2.jpg',
      trackUrl: 'https://last.fm/3',
    },
    {
      albumName: 'Album 3',
      artistName: 'Artist C',
      imageUrl: null,
      trackUrl: 'https://last.fm/4',
    },
  ]);

  assert.equal(albums.length, 2);
  assert.equal(albums[0].albumName, 'Album 1');
  assert.equal(albums[1].albumName, 'Album 2');
});

test('parseTopAlbums and mergeAlbumPools combine recent and top albums cleanly', () => {
  const top = app.parseTopAlbums({
    topalbums: {
      album: [
        {
          name: 'Album 1',
          artist: { name: 'Artist A' },
          image: [{ size: 'extralarge', '#text': 'https://img.example/1.jpg' }],
          url: 'https://last.fm/a1',
        },
        {
          name: 'Top Only',
          artist: { name: 'Artist D' },
          image: [{ size: 'extralarge', '#text': 'https://img.example/top.jpg' }],
          url: 'https://last.fm/top',
        },
      ],
    },
  });

  const merged = app.mergeAlbumPools(
    [
      {
        albumName: 'Album 1',
        artistName: 'Artist A',
        imageUrl: 'https://img.example/1.jpg',
      },
    ],
    top,
    10
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].albumName, 'Album 1');
  assert.equal(merged[1].albumName, 'Top Only');
});

test('buildTileAssignments fills all tiles with varied covers and avoids adjacent duplicates', () => {
  const albums = Array.from({ length: 6 }, (_, i) => ({
    albumName: `Album ${i}`,
    artistName: `Artist ${i}`,
    imageUrl: `https://img.example/${i}.jpg`,
  }));

  const cols = 5;
  const rows = 4;
  const grid = app.buildTileAssignments(albums, cols, rows);

  assert.equal(grid.length, cols * rows);
  const centerIdx = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  assert.equal(grid[centerIdx].albumName, 'Album 0');

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      if (c > 0) {
        assert.notEqual(grid[idx].imageUrl, grid[idx - 1].imageUrl);
      }
      if (r > 0) {
        assert.notEqual(grid[idx].imageUrl, grid[idx - cols].imageUrl);
      }
    }
  }
});

test('parseStaticSnapshot normalizes valid albums and rejects invalid URLs', () => {
  const parsed = app.parseStaticSnapshot({
    updatedAt: '2026-11-18T12:00:00.000Z',
    primary: {
      trackName: 'Song A',
      artistName: 'Artist A',
      albumName: 'Album A',
      playedUts: 1700000000,
      imageUrl: 'http://img.example/a.jpg',
    },
    albums: [
      {
        albumName: 'Album A',
        artistName: 'Artist A',
        imageUrl: 'http://img.example/a.jpg',
      },
      {
        albumName: 'Bad',
        artistName: 'Artist B',
        imageUrl:
          'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png',
      },
    ],
  });

  assert.equal(parsed.primary.imageUrl, 'https://img.example/a.jpg');
  assert.equal(parsed.albums.length, 1);
  assert.equal(parsed.albums[0].imageUrl, 'https://img.example/a.jpg');
});

test('buildLastfmSnapshot builds combined recent + top albums snapshot without exposing key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsedUrl = new URL(url);
    const method = parsedUrl.searchParams.get('method');
    if (method === 'user.getrecenttracks') {
      return {
        ok: true,
        json: async () => ({
          recenttracks: {
            track: [
              {
                name: 'Recent Song',
                artist: { '#text': 'Recent Artist' },
                album: { '#text': 'Recent Album' },
                '@attr': { nowplaying: 'true' },
                image: [{ size: 'extralarge', '#text': 'https://img.example/recent.jpg' }],
              },
            ],
          },
        }),
      };
    }
    if (method === 'user.gettopalbums') {
      return {
        ok: true,
        json: async () => ({
          topalbums: {
            album: [
              {
                name: 'Top Album',
                artist: { name: 'Top Artist' },
                image: [{ size: 'extralarge', '#text': 'https://img.example/top.jpg' }],
              },
            ],
          },
        }),
      };
    }
    throw new Error(`Unexpected fetch method: ${method}`);
  };

  try {
    const snapshot = await buildLastfmSnapshot({
      username: 'nichbar',
      apiKey: 'secret-test-key',
    });
    assert.equal(snapshot.username, 'nichbar');
    assert.equal(snapshot.primary.trackName, 'Recent Song');
    assert.equal(snapshot.primary.nowPlaying, false);
    assert.equal(snapshot.albums.length, 2);
    assert.equal(JSON.stringify(snapshot).includes('secret-test-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildDemoAlbums generates distinct procedural covers for preview mode', () => {
  const demo = app.buildDemoAlbums(12, 'nichbar', 'https://www.last.fm/user/nichbar');
  assert.equal(demo.length, 12);
  const uniqueUrls = new Set(demo.map((d) => d.imageUrl));
  assert.equal(uniqueUrls.size, 12);
});

test('parseRecentTracks throws on Last.fm API error object', () => {
  assert.throws(
    () => app.parseRecentTracks({ error: 10, message: 'Invalid API key' }),
    (err) => err.code === 10 && /Invalid API key/.test(err.message)
  );
});

test('computeGridDimensions overscans viewport for seamless drift coverage', () => {
  const dims = app.computeGridDimensions(1440, 900, 140);
  assert.ok(dims.gridWidth > 1440);
  assert.ok(dims.gridHeight > 900);
  assert.equal(dims.totalTiles, dims.cols * dims.rows);
  assert.ok(dims.tileSize >= 96);
});

test('computeGridDimensions ensures at least 4 visible columns and 4 visible rows on mobile', () => {
  const portrait = app.computeGridDimensions(390, 844, 140);
  assert.ok(portrait.cols - 2 >= 4);
  assert.ok(portrait.rows - 2 >= 4);
  assert.ok((portrait.cols - 2) * portrait.tileSize >= 390);
  assert.ok(portrait.gridWidth > 390);
  assert.ok(portrait.gridHeight > 844);

  const portraitLegacyTarget = app.computeGridDimensions(375, 667, 220);
  assert.equal(portraitLegacyTarget.cols - 2, 4);
  assert.ok(portraitLegacyTarget.rows - 2 >= 4);
  assert.ok(portraitLegacyTarget.tileSize <= 96);

  const landscape = app.computeGridDimensions(844, 390, 140);
  assert.ok(landscape.cols - 2 >= 4);
  assert.ok(landscape.rows - 2 >= 4);
  assert.ok(4 * landscape.tileSize <= 390);
  assert.ok(landscape.gridWidth > 844);
  assert.ok(landscape.gridHeight > 390);
});

test('buildTileMatrix and stepGridMatrix shift a single row or column with wrap-around', () => {
  const albums = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((id) => ({
    albumName: id,
    artistName: id,
    imageUrl: `https://img.example/${id}.jpg`,
  }));

  const matrix = [
    [albums[0], albums[1], albums[2]],
    [albums[3], albums[4], albums[5]],
    [albums[6], albums[7], albums[8]],
  ];

  // Row 1 slides right by 1: [D, E, F] -> [F, D, E]
  const rowRight = app.stepGridMatrix(matrix, 'row', 1, 1);
  assert.deepEqual(
    rowRight[1].map((a) => a.albumName),
    ['F', 'D', 'E']
  );
  // Other rows stay unchanged
  assert.deepEqual(
    rowRight[0].map((a) => a.albumName),
    ['A', 'B', 'C']
  );

  // Column 1 slides up by 1 (-1): [B, D, H] -> [D, H, B]
  const colUp = app.stepGridMatrix(rowRight, 'col', 1, -1);
  assert.deepEqual(
    [colUp[0][1].albumName, colUp[1][1].albumName, colUp[2][1].albumName],
    ['D', 'H', 'B']
  );
  // Original matrix is not mutated
  assert.equal(matrix[1][0].albumName, 'D');

  const built = app.buildTileMatrix(albums, 3, 3);
  assert.equal(built.length, 3);
  assert.equal(built[0].length, 3);
});

test('pickRandomLineSlide chooses valid interior lines when overscan is present and non-zero delta', () => {
  let step = 0;
  const values = [0.1, 0.5, 0.2, 0.9, 0.8, 0.4, 0.7, 0.1];
  const rng = () => values[step++ % values.length];

  const rowMove = app.pickRandomLineSlide(6, 8, rng);
  assert.equal(rowMove.axis, 'row');
  assert.ok(rowMove.index >= 1 && rowMove.index <= 4);
  assert.ok(rowMove.delta === -2 || rowMove.delta === -1 || rowMove.delta === 1 || rowMove.delta === 2);

  const colMove = app.pickRandomLineSlide(6, 8, rng);
  assert.equal(colMove.axis, 'col');
  assert.ok(colMove.index >= 1 && colMove.index <= 6);
  assert.ok(colMove.delta === -2 || colMove.delta === -1 || colMove.delta === 1 || colMove.delta === 2);
});

test('resolveApiKey checks query string, storage, then config and ignores placeholder', () => {
  const mockStorage = {
    getItem: () => 'stored-key',
  };

  assert.equal(
    app.resolveApiKey({ lastfmApiKey: 'YOUR_LASTFM_API_KEY' }, '?apiKey=query-key', mockStorage),
    'query-key'
  );
  assert.equal(
    app.resolveApiKey({ lastfmApiKey: 'YOUR_LASTFM_API_KEY' }, '', mockStorage),
    'stored-key'
  );
  assert.equal(
    app.resolveApiKey({ lastfmApiKey: 'config-key' }, '', { getItem: () => null }),
    'config-key'
  );
  assert.equal(
    app.resolveApiKey({ lastfmApiKey: 'YOUR_LASTFM_API_KEY' }, '', { getItem: () => null }),
    null
  );
});
