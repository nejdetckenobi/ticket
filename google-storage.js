(function (root) {
  "use strict";
  const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
  const REQUIRED_HEADERS = ["event", "full_name", "scanned_at", "token"];
  let readyPromise;
  let tokenClient;
  let accessToken = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing && existing.dataset.loaded) return resolve();
      const script = existing || document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => { script.dataset.loaded = "true"; resolve(); };
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      if (!existing) document.head.appendChild(script);
    });
  }

  function configured(config) {
    return config && !Object.values(config).some((value) =>
      typeof value === "string" && value.startsWith("REPLACE_WITH_"));
  }

  async function initialize(config) {
    if (!configured(config)) throw new Error("Google storage is not configured.");
    if (!readyPromise) readyPromise = Promise.all([
      loadScript("https://accounts.google.com/gsi/client"),
      loadScript("https://apis.google.com/js/api.js")
    ]).then(() => new Promise((resolve, reject) => {
      gapi.load("client:picker", async () => {
        try {
          await gapi.client.init({ apiKey: config.apiKey, discoveryDocs: config.discoveryDocs });
          tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: config.clientId,
            scope: config.scopes.join(" "),
            callback: () => {}
          });
          resolve();
        } catch (error) { reject(error); }
      });
    }));
    return readyPromise;
  }

  async function authorize(config, prompt = "") {
    await initialize(config);
    return new Promise((resolve, reject) => {
      tokenClient.callback = (response) => {
        if (response.error) return reject(new Error(response.error_description || response.error));
        accessToken = response.access_token;
        gapi.client.setToken({ access_token: accessToken });
        resolve(accessToken);
      };
      tokenClient.error_callback = (error) => reject(new Error(error.type || "Authorization cancelled"));
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : prompt });
    });
  }

  async function ensureAuthorized(config, interactive = false) {
    if (accessToken) return accessToken;
    return authorize(config, interactive ? "consent" : "");
  }

  async function pickSpreadsheet(config) {
    await ensureAuthorized(config, true);
    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setMimeTypes(SHEETS_MIME)
        .setSelectFolderEnabled(false);
      const picker = new google.picker.PickerBuilder()
        .setAppId(config.appId).setDeveloperKey(config.apiKey).setOAuthToken(accessToken)
        .addView(view).setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs[0];
            resolve({ spreadsheetId: doc.id, spreadsheetName: doc.name });
          } else if (data.action === google.picker.Action.CANCEL) reject(new DOMException("File selection cancelled", "AbortError"));
        }).build();
      picker.setVisible(true);
    });
  }

  function apiError(error) {
    const status = error && (error.status || (error.result && error.result.error && error.result.error.code));
    if (status === 401) { accessToken = null; return new Error("Google authorization expired. Please authorize again."); }
    if (status === 403) return new Error("Access to the Google Sheet was denied.");
    if (status === 404) return new Error("The selected Google Sheet no longer exists or is unavailable.");
    return new Error((error && error.message) || "Google Sheets could not be reached. Check your network connection.");
  }

  async function request(config, operation, retry = true) {
    try { await ensureAuthorized(config, false); return await operation(); }
    catch (error) {
      const status = error && (error.status || (error.result && error.result.error && error.result.error.code));
      if (retry && status === 401) { accessToken = null; await ensureAuthorized(config, true); return request(config, operation, false); }
      throw apiError(error);
    }
  }

  async function ensureHistorySheet(config, spreadsheetId) {
    return request(config, async () => {
      const metadata = await gapi.client.sheets.spreadsheets.get({ spreadsheetId });
      let sheet = metadata.result.sheets.find((item) => item.properties.title === "History");
      if (!sheet) {
        const created = await gapi.client.sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: [{ addSheet: { properties: { title: "History" } } }] } });
        sheet = created.result.replies[0].addSheet;
      }
      const response = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range: "History!1:1" });
      const headers = (response.result.values && response.result.values[0]) || [];
      if (!headers.length) {
        await gapi.client.sheets.spreadsheets.values.update({ spreadsheetId, range: "History!A1:D1", valueInputOption: "RAW", resource: { values: [REQUIRED_HEADERS] } });
        return REQUIRED_HEADERS;
      }
      const normalized = headers.map((value) => String(value).trim().toLowerCase());
      if (!REQUIRED_HEADERS.every((header) => normalized.includes(header))) throw new Error("History sheet has incompatible headers. Required: " + REQUIRED_HEADERS.join(", "));
      return normalized;
    });
  }

  async function read(config, spreadsheetId) {
    const headers = await ensureHistorySheet(config, spreadsheetId);
    return request(config, async () => {
      const response = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range: "History!A2:ZZ" });
      return ((response.result.values) || []).map((row) => ({
        e: row[headers.indexOf("event")] || "", f: row[headers.indexOf("full_name")] || "",
        scannedAt: row[headers.indexOf("scanned_at")] || "", token: row[headers.indexOf("token")] || ""
      })).reverse();
    });
  }

  async function append(config, spreadsheetId, payload) {
    const headers = await ensureHistorySheet(config, spreadsheetId);
    const values = { event: payload.e, full_name: payload.f, scanned_at: payload.scannedAt, token: payload.token };
    return request(config, () => gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId, range: "History!A:ZZ", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      resource: { values: [headers.map((header) => values[header] || "")] }
    }));
  }

  async function clear(config, spreadsheetId) {
    await ensureHistorySheet(config, spreadsheetId);
    return request(config, () => gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId, range: "History!A2:ZZ" }));
  }

  root.GoogleHistoryStorage = { initialize, authorize, pickSpreadsheet, ensureHistorySheet, read, append, clear, _constants: { SHEETS_MIME, REQUIRED_HEADERS } };
  if (typeof module !== "undefined") module.exports = root.GoogleHistoryStorage;
})(typeof window !== "undefined" ? window : globalThis);
