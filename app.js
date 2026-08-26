/* Meta-Stripper by Uli
   All image processing is local to the browser. */

"use strict";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const JPEG_HEADER_SCAN_BYTES = 2 * 1024 * 1024;

const MIME_TO_FORMAT = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const FORMAT_TO_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const imageInput = document.getElementById("image-input");
const stripForm = document.getElementById("strip-form");
const stripButton = document.getElementById("strip-button");
const resetButton = document.getElementById("reset-button");
const dropZone = document.getElementById("drop-zone");
const fileSummary = document.getElementById("file-summary");
const sourcePreview = document.getElementById("source-preview");
const sourceName = document.getElementById("source-name");
const sourceType = document.getElementById("source-type");
const sourceSize = document.getElementById("source-size");
const sourceDimensions = document.getElementById("source-dimensions");
const fileError = document.getElementById("file-error");
const outputFormat = document.getElementById("output-format");
const quality = document.getElementById("quality");
const qualityValue = document.getElementById("quality-value");
const result = document.getElementById("result");
const resultTitle = document.getElementById("result-title");
const resultPreview = document.getElementById("result-preview");
const resultType = document.getElementById("result-type");
const resultSize = document.getElementById("result-size");
const sourceMarkers = document.getElementById("source-markers");
const resultMarkers = document.getElementById("result-markers");
const verificationBadge = document.getElementById("verification-badge");
const verificationCopy = document.getElementById("verification-copy");
const downloadLink = document.getElementById("download-link");
const status = document.getElementById("status");
const pwaStatus = document.getElementById("pwa-status");

let selectedFile = null;
let selectedFormat = null;
let sourceObjectUrl = null;
let resultObjectUrl = null;
let processing = false;

function setStatus(message) {
  status.textContent = message;
}

function showFileError(message) {
  fileError.textContent = message;
  fileError.hidden = false;
  imageInput.setAttribute("aria-invalid", "true");
}

function clearFileError() {
  fileError.textContent = "";
  fileError.hidden = true;
  imageInput.removeAttribute("aria-invalid");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function sanitizeBaseName(filename) {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || "image";
}

function readAscii(bytes, start, length) {
  let output = "";
  const end = Math.min(start + length, bytes.length);

  for (let index = start; index < end; index += 1) {
    const value = bytes[index];
    output += value >= 32 && value <= 126 ? String.fromCharCode(value) : ".";
  }

  return output;
}

function containsAscii(bytes, start, end, needle) {
  const target = Array.from(needle, (character) => character.charCodeAt(0));
  const safeEnd = Math.min(end, bytes.length) - target.length;

  for (let index = Math.max(0, start); index <= safeEnd; index += 1) {
    let matches = true;

    for (let offset = 0; offset < target.length; offset += 1) {
      if (bytes[index + offset] !== target[offset]) {
        matches = false;
        break;
      }
    }

    if (matches) return true;
  }

  return false;
}

async function detectImageFormat(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  const isJpeg = bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  const isPng = bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  const isWebp = bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === "RIFF" &&
    readAscii(bytes, 8, 4) === "WEBP";

  if (isJpeg) return "jpeg";
  if (isPng) return "png";
  if (isWebp) return "webp";

  return null;
}

function validateClaimedMime(file, detectedFormat) {
  const claimedFormat = MIME_TO_FORMAT.get(file.type);
  if (!claimedFormat) return detectedFormat !== null;
  return claimedFormat === detectedFormat;
}

async function getImageDimensions(file, format) {
  if (format === "png") {
    const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    if (bytes.length < 24) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
    };
  }

  if (format === "webp") {
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (bytes.length < 30) return null;

    const chunkType = readAscii(bytes, 12, 4);

    if (chunkType === "VP8X") {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { width, height };
    }

    if (chunkType === "VP8L" && bytes[20] === 0x2f) {
      const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
      const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
      return { width, height };
    }

    if (
      chunkType === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return { width, height };
    }

    return null;
  }

  if (format === "jpeg") {
    const scanSize = Math.min(file.size, JPEG_HEADER_SCAN_BYTES);
    const bytes = new Uint8Array(await file.slice(0, scanSize).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

    const sofMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3,
      0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb,
      0xcd, 0xce, 0xcf,
    ]);

    let offset = 2;

    while (offset + 4 <= bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;

      const marker = bytes[offset];
      offset += 1;

      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;

      const segmentLength = view.getUint16(offset, false);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

      if (sofMarkers.has(marker) && segmentLength >= 7) {
        return {
          height: view.getUint16(offset + 3, false),
          width: view.getUint16(offset + 5, false),
        };
      }

      offset += segmentLength;
    }
  }

  return null;
}

function validateDimensions(dimensions) {
  if (!dimensions) {
    throw new Error("The image dimensions could not be read safely. Try a standard JPEG, PNG or WebP export.");
  }

  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The image reports invalid dimensions.");
  }

  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) {
    throw new Error(`This image is too large to process safely. The limit is ${Math.round(MAX_PIXELS / 1_000_000)} megapixels.`);
  }
}

async function validateFile(file) {
  if (!(file instanceof File)) throw new Error("Choose a valid local image file.");
  if (file.size < 1) throw new Error("The selected file is empty.");

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`The selected file is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB safety limit.`);
  }

  const detectedFormat = await detectImageFormat(file);
  if (!detectedFormat) throw new Error("Only real JPEG, PNG and WebP image files are accepted.");

  if (!validateClaimedMime(file, detectedFormat)) {
    throw new Error("The file MIME type does not match the image signature.");
  }

  const dimensions = await getImageDimensions(file, detectedFormat);
  validateDimensions(dimensions);
  return { detectedFormat, dimensions };
}

function getMimeForFormat(format) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return null;
}

async function selectFile(file) {
  clearFileError();
  setStatus("");

  try {
    const { detectedFormat, dimensions } = await validateFile(file);
    selectedFile = file;
    selectedFormat = detectedFormat;

    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = URL.createObjectURL(file);
    sourcePreview.src = sourceObjectUrl;

    sourceName.textContent = file.name || "Local image";
    sourceType.textContent = getMimeForFormat(detectedFormat);
    sourceSize.textContent = formatBytes(file.size);
    sourceDimensions.textContent = `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} px`;
    fileSummary.hidden = false;

    clearResult();
    setStatus("Ready to strip.");
  } catch (error) {
    selectedFile = null;
    selectedFormat = null;
    fileSummary.hidden = true;
    clearResult();
    showFileError(error instanceof Error ? error.message : "The image could not be validated.");
  }
}

function getRequestedMime() {
  if (outputFormat.value !== "auto") return outputFormat.value;
  return getMimeForFormat(selectedFormat) || "image/png";
}

function setProcessingState(isProcessing) {
  processing = isProcessing;
  stripButton.setAttribute("aria-disabled", String(isProcessing));
  resetButton.setAttribute("aria-disabled", String(isProcessing));
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the HTML image decoder.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    image.src = objectUrl;
    await image.decode();

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw(context) {
        context.drawImage(image, 0, 0);
      },
      close() {},
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToBlob(canvas, mime, qualityNumber) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("This browser could not encode the cleaned image.")),
      mime,
      qualityNumber
    );
  });
}

async function reencodeImage(file, mime, qualityNumber) {
  const decoded = await decodeImage(file);

  try {
    validateDimensions({ width: decoded.width, height: decoded.height });

    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;

    const context = canvas.getContext("2d", {
      alpha: mime !== "image/jpeg",
      willReadFrequently: false,
    });

    if (!context) throw new Error("The browser could not create a safe image canvas.");

    if (mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (typeof decoded.draw === "function") {
      decoded.draw(context);
    } else {
      context.drawImage(decoded, 0, 0);
    }

    const blob = await canvasToBlob(canvas, mime, qualityNumber);
    canvas.width = 1;
    canvas.height = 1;
    return blob;
  } finally {
    if (typeof decoded.close === "function") decoded.close();
  }
}

function addUnique(target, label) {
  if (!target.includes(label)) target.push(label);
}

function scanJpegMetadata(bytes) {
  const markers = [];
  const technical = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { markers: ["Invalid JPEG structure"], technical };
  }

  let offset = 2;

  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;

    if (marker === 0xe1) {
      if (containsAscii(bytes, payloadStart, payloadEnd, "Exif")) {
        addUnique(markers, "EXIF");
      } else {
        addUnique(markers, "XMP / APP1");
      }
    } else if (marker === 0xed) {
      addUnique(markers, "IPTC / APP13");
    } else if (marker === 0xeb) {
      if (
        containsAscii(bytes, payloadStart, payloadEnd, "c2pa") ||
        containsAscii(bytes, payloadStart, payloadEnd, "jumb") ||
        containsAscii(bytes, payloadStart, payloadEnd, "jumd")
      ) {
        addUnique(markers, "C2PA / JUMBF");
      } else {
        addUnique(markers, "APP11 metadata");
      }
    } else if (marker === 0xfe) {
      addUnique(markers, "JPEG comment");
    } else if (marker === 0xe2 && containsAscii(bytes, payloadStart, payloadEnd, "ICC_PROFILE")) {
      addUnique(technical, "ICC color profile");
    } else if (marker === 0xe0) {
      addUnique(technical, "JFIF header");
    } else if (marker === 0xee) {
      addUnique(technical, "Adobe encoder marker");
    }

    offset += segmentLength;
  }

  return { markers, technical };
}

function scanPngMetadata(bytes) {
  const markers = [];
  const technical = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = readAscii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;

    if (type === "eXIf") addUnique(markers, "EXIF");
    if (type === "iTXt" || type === "tEXt" || type === "zTXt") addUnique(markers, "Text / XMP");
    if (type === "tIME") addUnique(markers, "Timestamp");
    if (type === "caBX") addUnique(markers, "C2PA / JUMBF");
    if (type === "iCCP") addUnique(technical, "ICC color profile");
    if (type === "sRGB") addUnique(technical, "sRGB rendering intent");
    if (type === "gAMA") addUnique(technical, "Gamma");
    if (type === "cHRM") addUnique(technical, "Chromaticity");
    if (type === "pHYs") addUnique(technical, "Pixel density");

    offset = dataEnd + 4;
    if (type === "IEND") break;
  }

  return { markers, technical };
}

function scanWebpMetadata(bytes) {
  const markers = [];
  const technical = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = readAscii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === "EXIF") addUnique(markers, "EXIF");
    if (type === "XMP ") addUnique(markers, "XMP");
    if (type === "C2PA") addUnique(markers, "C2PA / JUMBF");
    if (type === "ICCP") addUnique(technical, "ICC color profile");

    if (
      containsAscii(bytes, dataStart, dataEnd, "c2pa") ||
      containsAscii(bytes, dataStart, dataEnd, "jumb")
    ) {
      addUnique(markers, "C2PA / JUMBF");
    }

    offset = dataEnd + (length % 2);
  }

  return { markers, technical };
}

async function scanMetadata(blob, format) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (format === "jpeg") return scanJpegMetadata(bytes);
  if (format === "png") return scanPngMetadata(bytes);
  if (format === "webp") return scanWebpMetadata(bytes);
  return { markers: ["Unknown output format"], technical: [] };
}

function clearResult() {
  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = null;
  }

  result.hidden = true;
  resultPreview.removeAttribute("src");
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
  verificationBadge.classList.remove("is-clean", "is-blocked");
  verificationBadge.textContent = "CHECKING";
}

async function processImage() {
  if (processing) return;
  clearFileError();

  if (!selectedFile || !selectedFormat) {
    showFileError("Choose a JPEG, PNG or WebP image first.");
    imageInput.focus();
    return;
  }

  setProcessingState(true);
  clearResult();
  setStatus("Stripping source metadata locally…");

  try {
    const requestedMime = getRequestedMime();
    const qualityNumber = Number(quality.value) / 100;
    const sourceScan = await scanMetadata(selectedFile, selectedFormat);
    const outputBlob = await reencodeImage(selectedFile, requestedMime, qualityNumber);
    const actualFormat = MIME_TO_FORMAT.get(outputBlob.type);

    if (!actualFormat) throw new Error("The browser returned an unsupported output format.");

    const outputScan = await scanMetadata(outputBlob, actualFormat);
    const hasKnownSourceMarkers = outputScan.markers.length > 0;

    resultObjectUrl = URL.createObjectURL(outputBlob);
    resultPreview.src = resultObjectUrl;
    resultType.textContent = outputBlob.type;
    resultSize.textContent = formatBytes(outputBlob.size);
    sourceMarkers.textContent = sourceScan.markers.length > 0 ? sourceScan.markers.join(", ") : "No known source markers detected";
    resultMarkers.textContent = outputScan.markers.length > 0 ? outputScan.markers.join(", ") : "None detected";
    result.hidden = false;

    if (hasKnownSourceMarkers) {
      verificationBadge.textContent = "DOWNLOAD BLOCKED";
      verificationBadge.classList.add("is-blocked");
      verificationCopy.textContent = "A known source-metadata marker is still present in the browser-generated export. Meta-Stripper will not offer this file for download.";
      downloadLink.hidden = true;
      setStatus("Export blocked because a known metadata marker remained.");
    } else {
      verificationBadge.textContent = "KNOWN MARKERS CLEAN";
      verificationBadge.classList.add("is-clean");
      verificationCopy.textContent = "No known EXIF, XMP, IPTC or embedded C2PA/JUMBF source marker was detected in the export. Technical encoding information such as color or density data may still exist, and platform-side CR/C2PA matching cannot be guaranteed.";

      const extension = FORMAT_TO_EXTENSION.get(outputBlob.type) || "img";
      downloadLink.download = `${sanitizeBaseName(selectedFile.name)}-stripped.${extension}`;
      downloadLink.href = resultObjectUrl;
      downloadLink.hidden = false;
      setStatus("Stripping complete. The cleaned file is ready to download.");
    }

    resultTitle.focus();
  } catch (error) {
    clearResult();
    showFileError(error instanceof Error ? error.message : "The image could not be processed.");
    setStatus("Processing failed.");
  } finally {
    setProcessingState(false);
  }
}

function resetApp() {
  selectedFile = null;
  selectedFormat = null;
  clearFileError();
  clearResult();

  if (sourceObjectUrl) {
    URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = null;
  }

  sourcePreview.removeAttribute("src");
  fileSummary.hidden = true;
  sourceName.textContent = "";
  sourceType.textContent = "—";
  sourceSize.textContent = "—";
  sourceDimensions.textContent = "Checked before decoding";
  outputFormat.value = "auto";
  quality.value = "92";
  qualityValue.value = "92%";
  qualityValue.textContent = "92%";
  setStatus("");
}

imageInput.addEventListener("change", () => {
  const [file] = imageInput.files || [];
  if (file) selectFile(file);
});

stripForm.addEventListener("submit", (event) => {
  event.preventDefault();
  processImage();
});

stripForm.addEventListener("reset", (event) => {
  if (processing) {
    event.preventDefault();
    return;
  }
  queueMicrotask(resetApp);
});

quality.addEventListener("input", () => {
  const label = `${quality.value}%`;
  qualityValue.value = label;
  qualityValue.textContent = label;
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!processing) dropZone.classList.add("is-dragover");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragover");
  });
}

dropZone.addEventListener("drop", (event) => {
  if (processing) return;
  const [file] = event.dataTransfer?.files || [];

  if (!file) {
    showFileError("Drop one JPEG, PNG or WebP image file.");
    return;
  }

  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    imageInput.files = transfer.files;
  } catch {
    // Some browsers do not permit assigning to input.files.
  }

  selectFile(file);
});

window.addEventListener("beforeunload", () => {
  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      pwaStatus.textContent = "Offline support is active after the app shell has been cached.";
    } catch {
      pwaStatus.textContent = "Offline support is unavailable in this browser or hosting configuration.";
    }
  });
} else {
  pwaStatus.textContent = "Offline installation requires HTTPS (or localhost) and Service Worker support.";
}
