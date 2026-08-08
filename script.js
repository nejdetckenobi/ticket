const buttons = document.querySelectorAll("[data-tab]");
const contents = document.querySelectorAll(".tab-content");

buttons.forEach((button) => {
  button.addEventListener("click", async () => {
    const targetTab = button.dataset.tab;

    contents.forEach((content) => content.classList.remove("active"));
    document.getElementById(targetTab).classList.add("active");

    if (targetTab === "tab4") {
      await startCamera();
    } else {
      stopCamera();
    }

    if (targetTab === "tab5") {
      renderHistory();
    }
  });
});

function base64UrlEncode(value) {
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.enc.Utf8.parse(value)
  )
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);

  return CryptoJS.enc.Base64.parse(padded)
    .toString(CryptoJS.enc.Utf8);
}

function createHmacSignature(keyText, message) {
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(message, keyText)
  )
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("QR image could not be created."));
    }, type);
  });
}

const QR_ARTWORK_SIZE = 177;
const QR_OUTPUT_SIZE = 800;
const QART_RENDER_TIMEOUT_MS = 10000;
const SUPPORTED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

let selectedLogoDataUrl = "";
let settingsNoticeTimer = null;

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Logo image could not be loaded."));
    image.src = source;
  });
}

function getContainedImageSize(image, maximumSize = QR_ARTWORK_SIZE) {
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("Logo image has invalid dimensions.");
  }

  const scale = Math.min(
    1,
    maximumSize / image.naturalWidth,
    maximumSize / image.naturalHeight
  );

  return {
    width: Math.max(1, Math.round(image.naturalWidth * scale)),
    height: Math.max(1, Math.round(image.naturalHeight * scale))
  };
}

function drawImageHighQuality(context, image, x, y, width, height) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
}

async function normalizeLogoFile(file) {
  if (!SUPPORTED_LOGO_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPEG or WebP image.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const { width, height } = getContainedImageSize(image);
    const canvas = document.createElement("canvas");
    canvas.width = QR_ARTWORK_SIZE;
    canvas.height = QR_ARTWORK_SIZE;

    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawImageHighQuality(
      context,
      image,
      Math.round((canvas.width - width) / 2),
      Math.round((canvas.height - height) / 2),
      width,
      height
    );
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForQartCanvas(container) {
  return new Promise((resolve, reject) => {
    const existingCanvas = container.querySelector("canvas");
    if (existingCanvas) {
      resolve(existingCanvas);
      return;
    }

    const observer = new MutationObserver(() => {
      const canvas = container.querySelector("canvas");
      if (!canvas) return;

      clearTimeout(timeoutId);
      observer.disconnect();
      resolve(canvas);
    });
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Artistic QR rendering timed out."));
    }, QART_RENDER_TIMEOUT_MS);

    observer.observe(container, { childList: true });
  });
}

function upscaleQrCanvas(sourceCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = QR_OUTPUT_SIZE;
  canvas.height = QR_OUTPUT_SIZE;

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  const scale = Math.max(
    1,
    Math.floor(QR_OUTPUT_SIZE / sourceCanvas.width)
  );
  const renderedSize = sourceCanvas.width * scale;
  const offset = Math.floor((QR_OUTPUT_SIZE - renderedSize) / 2);
  context.drawImage(
    sourceCanvas,
    offset,
    offset,
    renderedSize,
    renderedSize
  );
  return canvas;
}

async function createArtisticQrCanvas(value, imagePath) {
  for (let version = 1; version <= 40; version += 1) {
    const container = document.createElement("div");

    try {
      new QArt({
        value,
        imagePath,
        filter: "color",
        version
      }).make(container);

      return upscaleQrCanvas(await waitForQartCanvas(container));
    } catch (error) {
      // qart.js requires an explicit version. Advance when the signed token
      // does not fit, while preserving its built-in H error correction.
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      if (/code length overflow/i.test(errorMessage) && version < 40) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Invitation data is too long for a QR code.");
}

function createStandardQrCanvas(value) {
  const canvas = document.createElement("canvas");
  new QRious({
    element: canvas,
    value,
    size: QR_OUTPUT_SIZE,
    level: "H"
  });
  return canvas;
}

async function generateInvitation() {
  await libraryPromise;
  const settings = getSavedSettings();
  const key = settings.key;
  const eventName = settings.eventName;
  const fullname = document.getElementById("fullname").value;

  if (!key || !eventName || !fullname) {
    alert("Fill in all fields.");
    return;
  }

  const header = base64UrlEncode(JSON.stringify({
    alg: "HS256",
    typ: "INV"
  }));

  const payload = base64UrlEncode(JSON.stringify({
    e: eventName,
    f: fullname
  }));

  const signingInput = `${header}.${payload}`;
  const signature = createHmacSignature(key, signingInput);
  const invitationText = `${signingInput}.${signature}`;

  try {
    const canvas = settings.logoDataUrl
      ? await createArtisticQrCanvas(invitationText, settings.logoDataUrl)
      : createStandardQrCanvas(invitationText);
    const blob = await canvasToBlob(canvas);
    const file = new File([blob], "invitation.png", {
      type: "image/png"
    });

    if (
      navigator.canShare &&
      navigator.canShare({ files: [file] }) &&
      navigator.share
    ) {
      await navigator.share({
        files: [file],
        title: "Invitation"
      });
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "invitation.png";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }

    alert(`QR generation failed: ${error.message}`);
  }
}

function showValidationResult(message, type) {
  const result = document.getElementById("result");
  result.textContent = message;
  result.className = type || "";

  if (resultClearTimer) {
    clearTimeout(resultClearTimer);
  }

  resultClearTimer = setTimeout(() => {
    result.textContent = "";
    result.className = "";
    resultClearTimer = null;
  }, 20000);
}

const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SHEETS_MIME_TYPE =
  "application/vnd.google-apps.spreadsheet";
const GOOGLE_API_TIMEOUT_MS = 15000;

let googleAccessToken = null;
let googleAccessTokenExpiresAt = 0;
let googlePickerPromise = null;

function getGoogleConfig() {
  return window.INVITATION_CONFIG || {};
}

function assertGoogleConfig() {
  const config = getGoogleConfig();

  if (
    !config.googleClientId ||
    !config.googleApiKey ||
    !config.googleAppId
  ) {
    throw new Error("Google integration is not configured.");
  }

  return config;
}

function waitForGoogleGlobal(predicate, errorMessage) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt >= GOOGLE_API_TIMEOUT_MS) {
        clearInterval(timer);
        reject(new Error(errorMessage));
      }
    }, 50);
  });
}

async function loadGooglePicker() {
  assertGoogleConfig();

  await Promise.all([
    waitForGoogleGlobal(
      () => Boolean(window.google?.accounts?.oauth2),
      "Google sign-in could not be loaded."
    ),
    waitForGoogleGlobal(
      () => Boolean(window.gapi?.load),
      "Google Picker could not be loaded."
    )
  ]);

  if (!googlePickerPromise) {
    googlePickerPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Google Picker could not be loaded."));
      }, GOOGLE_API_TIMEOUT_MS);

      window.gapi.load("picker", {
        callback: () => {
          clearTimeout(timeout);
          resolve();
        },
        onerror: () => {
          clearTimeout(timeout);
          reject(new Error("Google Picker could not be loaded."));
        }
      });
    });
  }

  return googlePickerPromise;
}

async function requestGoogleAccessToken() {
  const config = assertGoogleConfig();
  await loadGooglePicker();

  return new Promise((resolve, reject) => {
    const handleError = () => {
      reject(new Error("Google authorization was cancelled."));
    };

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      error_callback: handleError,
      callback: (response) => {
        if (!response?.access_token) {
          reject(new Error(
            response?.error_description || "Google authorization failed."
          ));
          return;
        }

        googleAccessToken = response.access_token;
        googleAccessTokenExpiresAt =
          Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
        resolve(googleAccessToken);
      }
    });

    tokenClient.requestAccessToken({ prompt: "" });
  });
}

function openGoogleSpreadsheetPicker(accessToken) {
  const config = assertGoogleConfig();

  return new Promise((resolve, reject) => {
    const view = new window.google.picker.DocsView(
      window.google.picker.ViewId.SPREADSHEETS
    )
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setMimeTypes(GOOGLE_SHEETS_MIME_TYPE);

    const picker = new window.google.picker.PickerBuilder()
      .setAppId(config.googleAppId)
      .setDeveloperKey(config.googleApiKey)
      .setOAuthToken(accessToken)
      .addView(view)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const document = data.docs?.[0];
          if (!document?.id) {
            reject(new Error("No spreadsheet was selected."));
            return;
          }

          resolve({ id: document.id, name: document.name || document.id });
        } else if (data.action === window.google.picker.Action.CANCEL) {
          reject(new DOMException("Selection cancelled.", "AbortError"));
        }
      })
      .build();

    picker.setVisible(true);
  });
}

async function selectGoogleSpreadsheet() {
  const button = document.getElementById("selectGoogleSpreadsheetBtn");
  const status = document.getElementById("googleSpreadsheetStatus");
  button.disabled = true;
  status.className = "";
  status.textContent = "Connecting to Google...";

  try {
    const token = await requestGoogleAccessToken();
    const spreadsheet = await openGoogleSpreadsheetPicker(token);
    const settings = getSavedSettings();

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ...settings,
      storageType: "google",
      googleSpreadsheetId: spreadsheet.id,
      googleSpreadsheetName: spreadsheet.name
    }));

    document.querySelector(
      'input[name="storageType"][value="google"]'
    ).checked = true;
    updateGoogleStorageUi();
  } catch (error) {
    if (error?.name !== "AbortError") {
      status.className = "error";
      status.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
}

async function googleApiFetch(url, options = {}) {
  if (
    !googleAccessToken ||
    Date.now() >= googleAccessTokenExpiresAt
  ) {
    googleAccessToken = null;
    throw new Error("Reconnect Google from Settings.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GOOGLE_API_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    });

    if (!response.ok) {
      let message = `Google API request failed (${response.status}).`;
      try {
        const body = await response.json();
        message = body.error?.message || message;
      } catch {
        // Keep the status-based error when Google returns a non-JSON body.
      }
      throw new Error(message);
    }

    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Google API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function quoteSheetTitle(title) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function getGoogleSheetContext(settings) {
  if (!settings.googleSpreadsheetId) {
    throw new Error("Select a Google spreadsheet in Settings.");
  }

  const spreadsheetId = encodeURIComponent(settings.googleSpreadsheetId);
  const metadata = await googleApiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      "?fields=sheets.properties(title%2Cindex)"
  );
  const sheet = [...(metadata.sheets || [])]
    .sort((a, b) => a.properties.index - b.properties.index)[0];

  if (!sheet?.properties?.title) {
    throw new Error("The spreadsheet has no worksheet.");
  }

  const sheetTitle = quoteSheetTitle(sheet.properties.title);
  const valuesBase =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/`;

  return { sheetTitle, valuesBase };
}

async function getGoogleSheetValidationRows(context) {
  const dataRange = encodeURIComponent(`${context.sheetTitle}!A2:D`);
  const data = await googleApiFetch(context.valuesBase + dataRange);
  return data.values || [];
}

function isDuplicateGoogleValidation(rows, record) {
  return rows.some((row) => {
    const savedToken = String(row[3] || "");

    if (savedToken) {
      return savedToken === record.token;
    }

    // Rows created before the token column existed are matched by their
    // deterministic invitation payload.
    return row[0] === record.e && row[1] === record.f;
  });
}

async function appendValidationToGoogleSheet(settings, record, context) {
  const sheetContext = context || await getGoogleSheetContext(settings);
  const headerRange = encodeURIComponent(`${sheetContext.sheetTitle}!A1:D1`);
  const { valuesBase } = sheetContext;
  const header = await googleApiFetch(valuesBase + headerRange);
  const firstRow = header.values?.[0] || [];

  if (firstRow.every((value) => String(value).trim() === "")) {
    await googleApiFetch(
      `${valuesBase}${headerRange}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({
          majorDimension: "ROWS",
          values: [["event", "full_name", "scanned_at", "token"]]
        })
      }
    );
  } else if (!String(firstRow[3] || "").trim()) {
    const tokenHeaderRange = encodeURIComponent(
      `${sheetContext.sheetTitle}!D1`
    );
    await googleApiFetch(
      `${valuesBase}${tokenHeaderRange}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({
          majorDimension: "ROWS",
          values: [["token"]]
        })
      }
    );
  }

  const appendRange = encodeURIComponent(`${sheetContext.sheetTitle}!A:D`);
  await googleApiFetch(
    `${valuesBase}${appendRange}:append` +
      "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [[record.e, record.f, record.scannedAt, record.token]]
      })
    }
  );
}

async function handleQrResult(decodedText) {
  const key = getSavedSettings().key;

  if (!key) {
    showValidationResult("Enter a key.", "invalid");
    return;
  }

  const parts = decodedText.split(".");

  if (parts.length !== 3) {
    showValidationResult("Invalid invitation", "invalid");
    return;
  }

  const [headerPart, payloadPart, signature] = parts;
  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSignature = createHmacSignature(key, signingInput);

  if (signature !== expectedSignature) {
    showValidationResult("Invalid invitation", "invalid");
    return;
  }

  try {
    const header = JSON.parse(base64UrlDecode(headerPart));
    const payload = JSON.parse(base64UrlDecode(payloadPart));

    if (
      header.alg !== "HS256" ||
      typeof payload.e !== "string" ||
      typeof payload.f !== "string"
    ) {
      throw new Error("Invalid invitation");
    }

    const settings = getSavedSettings();
    let googleSheetContext = null;

    if (settings.preventDuplicates) {
      if (settings.storageType === "google") {
        try {
          googleSheetContext = await getGoogleSheetContext(settings);
          const rows = await getGoogleSheetValidationRows(googleSheetContext);
          const alreadyScanned = isDuplicateGoogleValidation(rows, {
            ...payload,
            token: decodedText
          });

          if (alreadyScanned) {
            showValidationResult("Invitation already validated", "duplicate");
            return;
          }
        } catch (error) {
          showValidationResult(
            `Duplicate check failed: ${error.message}\nInvitation was not validated.`,
            "warning"
          );
          return;
        }
      } else {
        const alreadyScanned = getHistory().some(
          (item) => item.token === decodedText
        );

        if (alreadyScanned) {
          showValidationResult("Invitation already validated", "duplicate");
          return;
        }
      }
    }

    const successMessage = `Event: ${payload.e}\nFullname: ${payload.f}`;
    const scannedAt = new Date().toISOString();
    showValidationResult(successMessage, "success");
    const cooldownSeconds =
      Number(getSavedSettings().cooldownSeconds) || 0;
    validationCooldownUntil =
      Date.now() + Math.max(0, cooldownSeconds) * 1000;
    saveHistory({ ...payload, token: decodedText, scannedAt });

    if (settings.storageType === "google") {
      try {
        await appendValidationToGoogleSheet(settings, {
          ...payload,
          scannedAt,
          token: decodedText
        }, googleSheetContext);
      } catch (error) {
        showValidationResult(
          `${successMessage}\nValidated, but could not save to Google: ${error.message}`,
          "warning"
        );
      }
    }
  } catch {
    showValidationResult("Invalid invitation", "invalid");
  }
}

document.getElementById("generateBtn")
  .addEventListener("click", generateInvitation);

const SETTINGS_KEY = "invitation_settings";

function getSavedSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function renderLogoPreview() {
  const container = document.getElementById("logoPreviewContainer");
  const preview = document.getElementById("logoPreview");
  const hasLogo = Boolean(selectedLogoDataUrl);

  container.hidden = !hasLogo;
  if (hasLogo) {
    preview.src = selectedLogoDataUrl;
  } else {
    preview.removeAttribute("src");
  }
}

function setSelectedLogo(logoDataUrl) {
  selectedLogoDataUrl = logoDataUrl || "";
  document.getElementById("logoFile").value = "";
  renderLogoPreview();
}

function showSettingsNotice(message, clearAfter = 0) {
  const notice = document.getElementById("settingsNotice");

  if (settingsNoticeTimer) {
    clearTimeout(settingsNoticeTimer);
    settingsNoticeTimer = null;
  }

  notice.textContent = message;
  if (clearAfter > 0) {
    settingsNoticeTimer = setTimeout(() => {
      notice.textContent = "";
      settingsNoticeTimer = null;
    }, clearAfter);
  }
}

async function handleLogoFileChange(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const logoDataUrl = await normalizeLogoFile(file);
    setSelectedLogo(logoDataUrl);
    showSettingsNotice("Logo ready. Save settings to keep it.");
  } catch (error) {
    showSettingsNotice(error.message);
  } finally {
    input.value = "";
  }
}

function removeLogo() {
  setSelectedLogo("");
  showSettingsNotice("Logo removed. Save settings to apply.");
}

function loadSettings() {
  const settings = getSavedSettings();
  document.getElementById("shared_key").value = settings.key || "";
  document.getElementById("event_name").value = settings.eventName || "";
  document.getElementById("cooldown_seconds").value =
    Number.isFinite(settings.cooldownSeconds)
      ? settings.cooldownSeconds
      : 5;
  document.getElementById("preventDuplicates").checked =
    Boolean(settings.preventDuplicates);
  document.getElementById("darkMode").checked = Boolean(settings.darkMode);
  window.applyTicketTokenTheme(Boolean(settings.darkMode));
  setSelectedLogo(settings.logoDataUrl);
  const storageType = settings.storageType === "google" ? "google" : "local";
  document.querySelector(
    `input[name="storageType"][value="${storageType}"]`
  ).checked = true;
  updateGoogleStorageUi();
}

function getSelectedStorageType() {
  return document.querySelector('input[name="storageType"]:checked')
    ?.value === "google" ? "google" : "local";
}

function updateGoogleStorageUi() {
  const settings = getSavedSettings();
  const isGoogle = getSelectedStorageType() === "google";
  const container = document.getElementById("googleStorageSettings");
  const status = document.getElementById("googleSpreadsheetStatus");

  container.hidden = !isGoogle;
  if (!isGoogle) return;

  status.className = "";
  const config = getGoogleConfig();
  if (
    !config.googleClientId ||
    !config.googleApiKey ||
    !config.googleAppId
  ) {
    status.className = "error";
    status.textContent = "Google integration is not configured.";
  } else if (!settings.googleSpreadsheetId) {
    status.textContent = "No spreadsheet selected.";
  } else if (!googleAccessToken) {
    status.textContent =
      `Selected: ${settings.googleSpreadsheetName}\nReconnect Google to write.`;
  } else {
    status.textContent = `Selected: ${settings.googleSpreadsheetName}`;
  }
}

function saveSettings() {
  const key = document.getElementById("shared_key").value;
  const eventName = document.getElementById("event_name").value;
  const cooldownSeconds = Math.max(
    0,
    Number(document.getElementById("cooldown_seconds").value) || 0
  );
  const preventDuplicates =
    document.getElementById("preventDuplicates").checked;
  const darkMode = document.getElementById("darkMode").checked;
  const storageType = getSelectedStorageType();
  const savedSettings = getSavedSettings();

  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      key,
      eventName,
      cooldownSeconds,
      preventDuplicates,
      darkMode,
      logoDataUrl: selectedLogoDataUrl,
      storageType,
      googleSpreadsheetId: savedSettings.googleSpreadsheetId || "",
      googleSpreadsheetName: savedSettings.googleSpreadsheetName || ""
    })
  );

  showSettingsNotice("Saved", 2000);
}

function clearSettings() {
  if (!confirm("Clear saved settings?")) {
    return;
  }

  localStorage.removeItem(SETTINGS_KEY);
  document.getElementById("shared_key").value = "";
  document.getElementById("event_name").value = "";
  document.getElementById("cooldown_seconds").value = "5";
  document.getElementById("preventDuplicates").checked = false;
  document.getElementById("darkMode").checked = false;
  setSelectedLogo("");
  window.applyTicketTokenTheme(false);
  document.querySelector(
    'input[name="storageType"][value="local"]'
  ).checked = true;
  googleAccessToken = null;
  googleAccessTokenExpiresAt = 0;
  updateGoogleStorageUi();
  showSettingsNotice("");
}

document.getElementById("saveSettingsBtn")
  .addEventListener("click", saveSettings);

document.getElementById("clearSettingsBtn")
  .addEventListener("click", clearSettings);

document.querySelectorAll('input[name="storageType"]')
  .forEach((input) => input.addEventListener("change", updateGoogleStorageUi));

document.getElementById("darkMode")
  .addEventListener("change", (event) => {
    window.applyTicketTokenTheme(event.target.checked);
  });

document.getElementById("logoFile")
  .addEventListener("change", handleLogoFileChange);

document.getElementById("removeLogoBtn")
  .addEventListener("click", removeLogo);

document.getElementById("selectGoogleSpreadsheetBtn")
  .addEventListener("click", selectGoogleSpreadsheet);

loadSettings();

const HISTORY_KEY = "invitation_history";

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(payload) {
  const history = getHistory();

  history.unshift({
    token: payload.token,
    e: payload.e,
    f: payload.f,
    scannedAt: payload.scannedAt || new Date().toISOString()
  });

  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function formatLocalTimestamp(isoString) {
  const date = new Date(isoString);
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(":");
}

function renderHistory() {
  const historyList = document.getElementById("historyList");
  const history = getHistory();

  if (history.length === 0) {
    historyList.textContent = "No history";
    return;
  }

  historyList.replaceChildren();

  history.forEach((item) => {
    const element = document.createElement("div");
    element.className = "history-item";
    element.textContent =
      `Event: ${item.e}\nFull name: ${item.f}\nScanned at: ${formatLocalTimestamp(item.scannedAt)}`;
    historyList.appendChild(element);
  });
}

function clearHistory() {
  if (!confirm("Clear all history?")) {
    return;
  }

  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportHistory() {
  const history = getHistory();

  if (history.length === 0) {
    return;
  }

  const rows = [
    ["event", "full_name", "scanned_at"],
    ...history.map((item) => [
      item.e,
      item.f,
      item.scannedAt
    ])
  ];

  const csv = rows
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "invitation-history.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById("exportHistoryBtn")
  .addEventListener("click", exportHistory);

document.getElementById("clearHistoryBtn")
  .addEventListener("click", clearHistory);

const resultElement = document.getElementById("result");
const video = document.getElementById("qrVideo");
const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d", {
  willReadFrequently: true
});

let cameraStream = null;
let scanning = false;
let lastVisibleQr = null;
let resultClearTimer = null;
let validationCooldownUntil = 0;
let validationInProgress = false;

function decodeCanvas(canvas, context) {
  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  return jsQR(
    imageData.data,
    imageData.width,
    imageData.height,
    { inversionAttempts: "attemptBoth" }
  );
}

function stopCamera() {
  scanning = false;
  lastVisibleQr = null;

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  video.srcObject = null;
}

function scanVideo() {
  if (!scanning) return;

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    scanCanvas.width = video.videoWidth;
    scanCanvas.height = video.videoHeight;

    scanContext.drawImage(
      video,
      0,
      0,
      scanCanvas.width,
      scanCanvas.height
    );

    const code = decodeCanvas(scanCanvas, scanContext);

    if (validationInProgress || Date.now() < validationCooldownUntil) {
      requestAnimationFrame(scanVideo);
      return;
    }

    if (code && typeof code.data === "string" && code.data.length > 0) {
      if (code.data !== lastVisibleQr) {
        lastVisibleQr = code.data;
        validationInProgress = true;
        handleQrResult(code.data)
          .finally(() => {
            validationInProgress = false;
          });
      }
    } else {
      lastVisibleQr = null;
    }
  }

  requestAnimationFrame(scanVideo);
}

async function startCamera() {
  try {
    await libraryPromise;
    if (typeof jsQR !== "function") {
      throw new Error("QR decoder could not be loaded.");
    }

    stopCamera();

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });

    video.srcObject = cameraStream;
    await video.play();

    scanning = true;
    requestAnimationFrame(scanVideo);
  } catch (error) {
    let message = "Camera could not be started.";

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      message = "Camera access is not supported by this browser.";
    } else if (error && error.name === "NotAllowedError") {
      message = "Camera permission was denied. Allow camera access in browser settings.";
    } else if (error && error.name === "NotFoundError") {
      message = "No camera was found on this device.";
    } else if (error && error.name === "NotReadableError") {
      message = "The camera is already in use by another application.";
    } else if (error && error.name === "OverconstrainedError") {
      message = "The requested camera mode is not available.";
    } else if (error && error.name === "SecurityError") {
      message = "Camera access requires a secure context such as HTTPS.";
    } else if (error && error.message) {
      message = error.message;
    }

    showValidationResult(message, "invalid");
  }
}
