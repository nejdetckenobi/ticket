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
    const canvas = document.createElement("canvas");
    new QRious({
      element: canvas,
      value: invitationText,
      size: 800,
      level: "M"
    });

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

function handleQrResult(decodedText) {
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
    const history = getHistory();
    const alreadyScanned = history.some(
      (item) => item.token === decodedText
    );

    if (settings.preventDuplicates && alreadyScanned) {
      showValidationResult("Invitation already validated", "duplicate");
      return;
    }

    showValidationResult(`Event: ${payload.e}\nFullname: ${payload.f}`, "success");
    const cooldownSeconds =
      Number(getSavedSettings().cooldownSeconds) || 0;
    validationCooldownUntil =
      Date.now() + Math.max(0, cooldownSeconds) * 1000;
    saveHistory({ ...payload, token: decodedText });
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

  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      key,
      eventName,
      cooldownSeconds,
      preventDuplicates
    })
  );

  const notice = document.getElementById("settingsNotice");
  notice.textContent = "Saved";

  setTimeout(() => {
    notice.textContent = "";
  }, 2000);
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
  document.getElementById("settingsNotice").textContent = "";
}

document.getElementById("saveSettingsBtn")
  .addEventListener("click", saveSettings);

document.getElementById("clearSettingsBtn")
  .addEventListener("click", clearSettings);

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
    scannedAt: new Date().toISOString()
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
