const libraryPromise = (async () => {
  const urls = [
    "https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js",
    "https://cdn.jsdelivr.net/npm/qartjs@1.1.1/dist/qart.min.js",
    "https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js",
    "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"
  ];

  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Library could not be loaded: ${url}`);
    }

    const source = await response.text();
    (0, eval)(source);
  }
})();
