import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../config.js');
const {
  parseRecentTracks,
  extractUniqueAlbums,
  parseTopAlbums,
  mergeAlbumPools,
  extractBestImage,
} = require('../app.js');

const API_BASE = 'https://ws.audioscrobbler.com/2.0/';

async function fetchJson(params) {
  const search = new URLSearchParams({
    ...params,
    format: 'json',
  });
  const res = await fetch(`${API_BASE}?${search.toString()}`);
  if (!res.ok) {
    throw new Error(`Last.fm HTTP ${res.status} for ${params.method}`);
  }
  const data = await res.json();
  if (data && data.error) {
    throw new Error(`Last.fm API error ${data.error}: ${data.message}`);
  }
  return data;
}

export async function buildLastfmSnapshot({ username, apiKey, maxAlbums = 250 }) {
  if (!apiKey) {
    throw new Error('Missing LASTFM_API_KEY environment variable');
  }
  const user = username || config.lastfmUsername || 'nichbar';

  const recentPayload = await fetchJson({
    method: 'user.getrecenttracks',
    user,
    api_key: apiKey,
    limit: '200',
  });

  const { primary, tracks } = parseRecentTracks(recentPayload);
  if (!primary) {
    return {
      updatedAt: new Date().toISOString(),
      username: user,
      primary: null,
      albums: [],
    };
  }

  let primaryCoverUrl = primary.imageUrl;
  if (!primaryCoverUrl && primary.artistName && primary.albumName) {
    try {
      const albumPayload = await fetchJson({
        method: 'album.getinfo',
        artist: primary.artistName,
        album: primary.albumName,
        api_key: apiKey,
        autocorrect: '1',
      });
      primaryCoverUrl = extractBestImage(albumPayload?.album?.image);
    } catch (_) {
      // Optional enrichment only
    }
  }

  const fallbackPlayedUts = Number.isFinite(primary.playedUts)
    ? primary.playedUts
    : primary.nowPlaying
    ? Math.floor(Date.now() / 1000)
    : tracks.find((t) => Number.isFinite(t.playedUts))?.playedUts ?? null;

  const primaryTrack = {
    ...primary,
    // A scheduled snapshot should not falsely claim a track is still live hours later
    nowPlaying: false,
    playedUts: fallbackPlayedUts,
    imageUrl: primaryCoverUrl,
  };

  const recentAlbums = extractUniqueAlbums(tracks);
  const primarySeed = primaryCoverUrl
    ? [
        {
          albumName: primary.albumName,
          artistName: primary.artistName,
          imageUrl: primaryCoverUrl,
          url: primary.trackUrl || config.lastfmProfileUrl,
        },
      ]
    : [];

  let albums = mergeAlbumPools(primarySeed, recentAlbums, maxAlbums);

  if (albums.length < maxAlbums) {
    try {
      const topPayload = await fetchJson({
        method: 'user.gettopalbums',
        user,
        api_key: apiKey,
        limit: String(Math.max(300, maxAlbums)),
      });
      const topAlbums = parseTopAlbums(topPayload);
      albums = mergeAlbumPools(albums, topAlbums, maxAlbums);
    } catch (err) {
      console.warn('Warning: failed to fetch user.gettopalbums:', err.message);
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    username: user,
    primary: primaryTrack,
    albums,
  };
}

async function main() {
  const apiKey = process.env.LASTFM_API_KEY;
  const username = process.env.LASTFM_USERNAME || config.lastfmUsername || 'nichbar';
  const outPath = path.resolve(process.cwd(), config.dataUrl || 'data/lastfm.json');

  const snapshot = await buildLastfmSnapshot({ username, apiKey });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  console.log(
    `Wrote ${outPath} (${snapshot.albums.length} unique albums, latest: ${
      snapshot.primary ? `${snapshot.primary.artistName} - ${snapshot.primary.trackName}` : 'none'
    })`
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
