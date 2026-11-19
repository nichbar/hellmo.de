(function (global) {
  const config = {
    siteDomain: 'hellmo.de',
    lastfmUsername: 'nichbar',
    // Static JSON generated every 6 hours by GitHub Actions (see .github/workflows/update-lastfm.yml)
    dataUrl: 'data/lastfm.json',
    lastfmProfileUrl: 'https://www.last.fm/user/nichbar',
    githubUsername: 'nichbar',
    githubUrl: 'https://www.github.com/nichbar',
    // Polls the local static JSON (never calls Last.fm API directly)
    pollIntervalMs: 300000,
    tileTargetSizePx: 140,
    ambientDrift: true,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  } else {
    global.HELLMO_CONFIG = config;
  }
})(typeof window !== 'undefined' ? window : globalThis);
