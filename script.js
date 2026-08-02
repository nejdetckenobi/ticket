const buttons = document.querySelectorAll("[data-tab]");
const contents = document.querySelectorAll(".tab-content");

buttons.forEach((button) => {
  button.addEventListener("click", async () => {
    const targetTab = button.dataset.tab;

    contents.forEach((content) => content.classList.remove("active"));
    document.getElementById(targetTab).classList.add("active");

    if (targetTab === "tab2") {
      await startCamera();
    } else {
      stopCamera();
    }

    if (targetTab === "tab4") {
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
    const qr = new QRious({
      value: invitationText,
      size: 800,
      level: "M"
    });

    const dataUrl = qr.toDataURL("image/png");
    const response = await fetch(dataUrl);
    const blob = await response.blob();
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

async function handleQrResult(decodedText) {
  const key = getSavedSettings().key;
  const result = document.getElementById("result");

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
    const history = await getHistory();
    const alreadyScanned = history.some(
      (item) => item.token === decodedText
    );

    if (settings.preventDuplicates && alreadyScanned) {
      showValidationResult("Invitation already validated", "duplicate");
      return;
    }

    await saveHistory({ ...payload, token: decodedText });
    showValidationResult(`Event: ${payload.e}\nFullname: ${payload.f}`, "success");
    const cooldownSeconds =
      Number(getSavedSettings().cooldownSeconds) || 0;
    validationCooldownUntil =
      Date.now() + Math.max(0, cooldownSeconds) * 1000;
  } catch (error) {
    showValidationResult(error && error.message ? error.message : "Invalid invitation", "invalid");
  }
}

document.getElementById("generateBtn")
  .addEventListener("click", generateInvitation);

const SETTINGS_KEY = "invitation_settings";

function getSavedSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...settings, historyStorage: settings.historyStorage === "google" ? "google" : "local" };
  } catch {
    return { historyStorage: "local" };
  }
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
  const radio = document.querySelector(`input[name="historyStorage"][value="${settings.historyStorage}"]`);
  if (radio) radio.checked = true;
  updateGoogleStatus(settings);
}

function setSettingsNotice(message, type = "") {
  const notice = document.getElementById("settingsNotice");
  notice.textContent = message;
  notice.className = type;
}

function updateGoogleStatus(settings = getSavedSettings(), error = "") {
  const status = document.getElementById("googleStorageStatus");
  if (error) { status.textContent = error; status.className = "storage-status error"; return; }
  if (settings.historyStorage === "google" && settings.spreadsheetId) {
    status.textContent = `Connected: ${settings.spreadsheetName || settings.spreadsheetId}`;
    status.className = "storage-status success";
  } else {
    status.textContent = settings.historyStorage === "google" ? "Google Sheet will be selected when you save" : "Stored on this device";
    status.className = "storage-status";
  }
}

async function saveSettings() {
  const key = document.getElementById("shared_key").value;
  const eventName = document.getElementById("event_name").value;
  const cooldownSeconds = Math.max(
    0,
    Number(document.getElementById("cooldown_seconds").value) || 0
  );
  const preventDuplicates =
    document.getElementById("preventDuplicates").checked;
  const historyStorage = document.querySelector('input[name="historyStorage"]:checked').value;
  const previous = getSavedSettings();
  let googleTarget = {};

  if (historyStorage === "google") {
    try {
      setSettingsNotice("Connecting to Google…");
      googleTarget = await GoogleHistoryStorage.pickSpreadsheet(GOOGLE_STORAGE_CONFIG);
      await GoogleHistoryStorage.ensureHistorySheet(GOOGLE_STORAGE_CONFIG, googleTarget.spreadsheetId);
    } catch (error) {
      const message = error && error.name === "AbortError" ? "Google file selection was cancelled. Previous settings were kept." : `Google setup failed: ${error.message}. Previous settings were kept.`;
      setSettingsNotice(message, "error");
      updateGoogleStatus(previous, message);
      return false;
    }
  }

  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      key,
      eventName,
      cooldownSeconds,
      preventDuplicates,
      historyStorage,
      ...(historyStorage === "google" ? googleTarget : {})
    })
  );

  setSettingsNotice("Saved", "success");
  updateGoogleStatus(getSavedSettings());

  setTimeout(() => {
    setSettingsNotice("");
  }, 2000);
  return true;
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
  document.querySelector('input[name="historyStorage"][value="local"]').checked = true;
  document.getElementById("settingsNotice").textContent = "";
  updateGoogleStatus({ historyStorage: "local" });
}

document.getElementById("saveSettingsBtn")
  .addEventListener("click", saveSettings);

document.getElementById("clearSettingsBtn")
  .addEventListener("click", clearSettings);

loadSettings();

document.querySelectorAll('input[name="historyStorage"]').forEach((radio) => {
  radio.addEventListener("change", () => updateGoogleStatus({
    ...getSavedSettings(),
    historyStorage: radio.value,
    spreadsheetId: radio.value === "google" ? getSavedSettings().spreadsheetId : undefined
  }));
});

// Prepare GIS, Picker, Drive and Sheets clients without initiating a login.
GoogleHistoryStorage.initialize(GOOGLE_STORAGE_CONFIG).catch(() => {
  // Configuration/load failures are reported if Google storage is selected.
});

const HISTORY_KEY = "invitation_history";

function getHistory() {
  const settings = getSavedSettings();
  if (settings.historyStorage === "google") {
    if (!settings.spreadsheetId) return Promise.reject(new Error("Select a Google Sheet in Settings first."));
    return GoogleHistoryStorage.read(GOOGLE_STORAGE_CONFIG, settings.spreadsheetId);
  }
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

async function saveHistory(payload) {
  const settings = getSavedSettings();
  const item = {
    token: payload.token,
    e: payload.e,
    f: payload.f,
    scannedAt: new Date().toISOString()
  };
  if (settings.historyStorage === "google") {
    if (!settings.spreadsheetId) throw new Error("Select a Google Sheet in Settings first.");
    await GoogleHistoryStorage.append(GOOGLE_STORAGE_CONFIG, settings.spreadsheetId, item);
    return item;
  }
  const history = getHistory();

  history.unshift(item);

  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return item;
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

async function renderHistory() {
  const historyList = document.getElementById("historyList");
  historyList.textContent = "Loading history…";
  let history;
  try { history = await getHistory(); }
  catch (error) { historyList.textContent = `History unavailable: ${error.message}`; historyList.className = "error"; return; }
  historyList.className = "";

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

async function clearHistory() {
  if (!confirm("Clear all history?")) {
    return;
  }

  const settings = getSavedSettings();
  try {
    if (settings.historyStorage === "google") await GoogleHistoryStorage.clear(GOOGLE_STORAGE_CONFIG, settings.spreadsheetId);
    else localStorage.removeItem(HISTORY_KEY);
    await renderHistory();
  } catch (error) {
    const historyList = document.getElementById("historyList");
    historyList.textContent = `History could not be cleared: ${error.message}`;
    historyList.className = "error";
  }
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportHistory() {
  const historyList = document.getElementById("historyList");
  let history;
  try { history = await getHistory(); }
  catch (error) { historyList.textContent = `Export failed: ${error.message}`; historyList.className = "error"; return; }

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

    if (Date.now() < validationCooldownUntil) {
      requestAnimationFrame(scanVideo);
      return;
    }

    if (code && typeof code.data === "string" && code.data.length > 0) {
      if (code.data !== lastVisibleQr) {
        lastVisibleQr = code.data;
        handleQrResult(code.data);
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
