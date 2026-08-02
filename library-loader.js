const libraryPromise = (async () => {
  const urls = [
    "https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js",
    "https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js",
    "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"
  ];

  for (const url of urls) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Library could not be loaded: ${url}`));
      document.head.appendChild(script);
    });
  }
})();
