/* Meta-Stripper by Uli
   All image processing is local to the browser. */

"use strict";

const DEFAULT_CONFIG = Object.freeze({
  maxFileBytes: 30 * 1024 * 1024,
  maxPixels: 50_000_000,
  maxBatchFiles: 20,
  jpegHeaderScanBytes: 2 * 1024 * 1024,
});

const runtimeConfig = window.META_STRIPPER_CONFIG || {};
const safeInt = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback;
const MAX_FILE_BYTES = safeInt(runtimeConfig.maxFileBytes, DEFAULT_CONFIG.maxFileBytes);
const MAX_PIXELS = safeInt(runtimeConfig.maxPixels, DEFAULT_CONFIG.maxPixels);
const MAX_BATCH_FILES = safeInt(runtimeConfig.maxBatchFiles, DEFAULT_CONFIG.maxBatchFiles);
const JPEG_HEADER_SCAN_BYTES = safeInt(runtimeConfig.jpegHeaderScanBytes, DEFAULT_CONFIG.jpegHeaderScanBytes);

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

const stripForm = document.getElementById("strip-form");
const imageInput = document.getElementById("image-input");
const stripButton = document.getElementById("strip-button");
const resetButton = document.getElementById("reset-button");
const stripMoreButton = document.getElementById("strip-more-button");
const heroUploadButton = document.getElementById("hero-upload-button");
const dropZone = document.getElementById("drop-zone");
const fileHint = document.getElementById("file-hint");
const fileError = document.getElementById("file-error");
const selection = document.getElementById("selection");
const selectedCount = document.getElementById("selected-count");
const selectedList = document.getElementById("selected-list");
const outputFormat = document.getElementById("output-format");
const quality = document.getElementById("quality");
const qualityValue = document.getElementById("quality-value");
const results = document.getElementById("results");
const resultsTitle = document.getElementById("results-title");
const resultsSummary = document.getElementById("results-summary");
const resultsList = document.getElementById("results-list");
const status = document.getElementById("status");
const pwaStatus = document.getElementById("pwa-status");

let selectedItems = [];
let resultUrls = [];
let processing = false;

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

function formatMegapixels(pixels) {
  return (pixels / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

fileHint.textContent = `Per image: ${formatBytes(MAX_FILE_BYTES)} and ${formatMegapixels(MAX_PIXELS)} MP. Batch: up to ${MAX_BATCH_FILES} files. Configure in config.js.`;

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

function sanitizeBaseName(filename) {
  const normalized = filename
    .replace(/\.[^.]+$/, "")
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

function readAsciiClean(bytes, start, length) {
  let output = "";
  const end = Math.min(start + length, bytes.length);

  for (let index = start; index < end; index += 1) {
    const value = bytes[index];
    if (value === 0) break;
    if (value >= 32 && value <= 126) output += String.fromCharCode(value);
  }

  return output.trim();
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

function addUnique(target, value) {
  if (value && !target.includes(value)) target.push(value);
}

function addDetail(target, label, value) {
  if (value === null || value === undefined || value === "") return;
  addUnique(target, `${label}: ${String(value).trim()}`);
}

function getMimeForFormat(format) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return null;
}

async function detectImageFormat(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && readAscii(bytes, 1, 3) === "PNG") return "png";
  if (bytes.length >= 12 && readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP") return "webp";

  return null;
}

async function getImageDimensions(file, format) {
  if (format === "png") {
    const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    if (bytes.length < 24) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }

  if (format === "webp") {
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (bytes.length < 30) return null;
    const chunkType = readAscii(bytes, 12, 4);

    if (chunkType === "VP8X") {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }

    if (chunkType === "VP8L" && bytes[20] === 0x2f) {
      return {
        width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)),
        height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
      };
    }

    if (chunkType === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      };
    }

    return null;
  }

  if (format === "jpeg") {
    const scanSize = Math.min(file.size, JPEG_HEADER_SCAN_BYTES);
    const bytes = new Uint8Array(await file.slice(0, scanSize).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;

    while (offset + 4 <= bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;

      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;

      const length = view.getUint16(offset, false);
      if (length < 2 || offset + length > bytes.length) break;

      if (sof.has(marker) && length >= 7) {
        return {
          height: view.getUint16(offset + 3, false),
          width: view.getUint16(offset + 5, false),
        };
      }

      offset += length;
    }
  }

  return null;
}

function validateDimensions(dimensions) {
  if (!dimensions) throw new Error("The image dimensions could not be read safely.");

  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The image reports invalid dimensions.");
  }

  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) {
    throw new Error(`The image exceeds the configured ${formatMegapixels(MAX_PIXELS)} MP limit.`);
  }
}

function parseExifDetails(bytes, start, end) {
  const details = [];
  let tiffStart = start;

  if (end - start >= 6 && readAscii(bytes, start, 4) === "Exif" && bytes[start + 4] === 0 && bytes[start + 5] === 0) {
    tiffStart += 6;
  }

  if (tiffStart + 8 > end) return details;
  const byteOrder = readAscii(bytes, tiffStart, 2);
  const little = byteOrder === "II";
  if (!little && byteOrder !== "MM") return details;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset) => offset >= tiffStart && offset + 2 <= end ? view.getUint16(offset, little) : null;
  const u32 = (offset) => offset >= tiffStart && offset + 4 <= end ? view.getUint32(offset, little) : null;

  if (u16(tiffStart + 2) !== 42) return details;

  function entryValue(entryOffset, type, count) {
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1, 9: 4 };
    const unit = sizes[type];
    if (!unit || count < 1 || count > 512) return null;

    const length = unit * count;
    let valueOffset = entryOffset + 8;

    if (length > 4) {
      const relative = u32(entryOffset + 8);
      if (relative === null) return null;
      valueOffset = tiffStart + relative;
    }

    if (valueOffset < tiffStart || valueOffset + length > end) return null;
    if (type === 2) return readAsciiClean(bytes, valueOffset, Math.min(count, 160));
    if (type === 3 && count === 1) return u16(valueOffset);
    if (type === 4 && count === 1) return u32(valueOffset);
    return null;
  }

  function parseIfd(relativeOffset, tags) {
    const offset = tiffStart + relativeOffset;
    const count = u16(offset);
    const pointers = {};
    if (count === null || count > 512) return pointers;

    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12;
      if (entry + 12 > end) break;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const valueCount = u32(entry + 4);
      if (tag === null || type === null || valueCount === null) continue;

      if (tag === 0x8769 || tag === 0x8825) {
        const pointer = entryValue(entry, type, valueCount);
        if (Number.isInteger(pointer)) pointers[tag] = pointer;
        continue;
      }

      const label = tags.get(tag);
      if (!label) continue;
      addDetail(details, label, entryValue(entry, type, valueCount));
    }

    return pointers;
  }

  const mainTags = new Map([
    [0x010e, "Description"], [0x010f, "Camera make"], [0x0110, "Camera model"],
    [0x0131, "Software"], [0x0132, "Modified"], [0x013b, "Artist"], [0x8298, "Copyright"],
  ]);
  const exifTags = new Map([
    [0x9003, "Date taken"], [0x9004, "Digitized"], [0xa431, "Camera serial"],
    [0xa433, "Lens make"], [0xa434, "Lens model"],
  ]);

  const firstIfd = u32(tiffStart + 4);
  if (!Number.isInteger(firstIfd)) return details;
  const pointers = parseIfd(firstIfd, mainTags);
  if (Number.isInteger(pointers[0x8769])) parseIfd(pointers[0x8769], exifTags);
  if (Number.isInteger(pointers[0x8825])) addDetail(details, "GPS", "location data present");

  return details.slice(0, 12);
}

function scanJpeg(bytes) {
  const markers = [];
  const technical = [];
  const details = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;

    const length = view.getUint16(offset, false);
    if (length < 2 || offset + length > bytes.length) break;
    const start = offset + 2;
    const end = offset + length;

    if (marker === 0xe1 && containsAscii(bytes, start, end, "Exif")) {
      addUnique(markers, "EXIF / GPS");
      parseExifDetails(bytes, start, end).forEach((detail) => addUnique(details, detail));
    } else if (marker === 0xe1) {
      addUnique(markers, "XMP / APP1");
    } else if (marker === 0xed) {
      addUnique(markers, "IPTC / APP13");
    } else if (marker === 0xeb) {
      addUnique(markers, containsAscii(bytes, start, end, "c2pa") || containsAscii(bytes, start, end, "jumb") ? "C2PA / JUMBF" : "APP11 metadata");
    } else if (marker === 0xfe) {
      addUnique(markers, "JPEG comment");
      addDetail(details, "Comment", readAsciiClean(bytes, start, Math.min(end - start, 120)));
    } else if (marker === 0xe2 && containsAscii(bytes, start, end, "ICC_PROFILE")) {
      addUnique(technical, "ICC color profile");
    } else if (marker === 0xe0) {
      addUnique(technical, "JFIF header");
    }

    offset += length;
  }

  return { markers, technical, details };
}

function scanPng(bytes) {
  const markers = [];
  const technical = [];
  const details = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = readAscii(bytes, offset + 4, 4);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) break;

    if (type === "eXIf") {
      addUnique(markers, "EXIF / GPS");
      parseExifDetails(bytes, start, end).forEach((detail) => addUnique(details, detail));
    }
    if (type === "iTXt" || type === "tEXt" || type === "zTXt") {
      addUnique(markers, type === "iTXt" ? "XMP / text metadata" : "Text metadata");
      if (type !== "zTXt") addDetail(details, "Text chunk", readAsciiClean(bytes, start, Math.min(length, 80)));
    }
    if (type === "tIME") addUnique(markers, "Timestamp");
    if (type === "caBX") addUnique(markers, "C2PA / JUMBF");
    if (type === "iCCP") addUnique(technical, "ICC color profile");
    if (type === "pHYs") addUnique(technical, "Pixel density");
    if (type === "sRGB") addUnique(technical, "sRGB rendering intent");

    offset = end + 4;
    if (type === "IEND") break;
  }

  return { markers, technical, details };
}

function scanWebp(bytes) {
  const markers = [];
  const technical = [];
  const details = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = readAscii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;

    if (type === "EXIF") {
      addUnique(markers, "EXIF / GPS");
      parseExifDetails(bytes, start, end).forEach((detail) => addUnique(details, detail));
    }
    if (type === "XMP ") addUnique(markers, "XMP");
    if (type === "C2PA" || containsAscii(bytes, start, end, "c2pa") || containsAscii(bytes, start, end, "jumb")) addUnique(markers, "C2PA / JUMBF");
    if (type === "ICCP") addUnique(technical, "ICC color profile");

    offset = end + (length % 2);
  }

  return { markers, technical, details };
}

async function scanMetadata(blob, format) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (format === "jpeg") return scanJpeg(bytes);
  if (format === "png") return scanPng(bytes);
  if (format === "webp") return scanWebp(bytes);
  return { markers: ["Unknown format"], technical: [], details: [] };
}

async function validateFile(file) {
  if (!(file instanceof File)) throw new Error("Choose a valid local image file.");
  if (file.size < 1) throw new Error("The file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error(`The file exceeds the configured ${formatBytes(MAX_FILE_BYTES)} limit.`);

  const format = await detectImageFormat(file);
  if (!format) throw new Error("Only real JPEG, PNG and WebP images are accepted.");
  const claimed = MIME_TO_FORMAT.get(file.type);
  if (claimed && claimed !== format) throw new Error("The file MIME type does not match its image signature.");

  const dimensions = await getImageDimensions(file, format);
  validateDimensions(dimensions);
  const sourceScan = await scanMetadata(file, format);
  return { format, dimensions, sourceScan };
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendFact(list, label, value) {
  const row = document.createElement("div");
  row.append(makeElement("dt", "", label), makeElement("dd", "", value));
  list.append(row);
}

function appendMetadata(body, scan) {
  body.append(makeElement("p", "metadata-title", "Source metadata to remove"));

  if (scan.markers.length === 0) {
    body.append(makeElement("p", "metadata-none", "No known source metadata marker detected. The image will still be re-encoded into a new file."));
  } else {
    const chips = makeElement("ul", "metadata-chips");
    scan.markers.forEach((marker) => chips.append(makeElement("li", "", marker)));
    body.append(chips);
  }

  if (scan.details.length > 0) {
    const list = makeElement("ul", "metadata-details");
    scan.details.forEach((detail) => list.append(makeElement("li", "", detail)));
    body.append(list);
  }

  if (scan.technical.length > 0) {
    body.append(makeElement("p", "metadata-none", `Technical source info detected separately: ${scan.technical.join(", ")}. The browser may generate new technical encoding data in the export.`));
  }
}

function renderSelected() {
  selectedList.replaceChildren();
  selection.hidden = selectedItems.length === 0;
  selectedCount.textContent = selectedItems.length ? `${selectedItems.length} selected` : "";
  stripButton.textContent = selectedItems.length > 1 ? `Strip ${selectedItems.length} images` : "Strip metadata";

  selectedItems.forEach((item) => {
    const card = makeElement("article", "image-card");
    const preview = makeElement("img", "preview-image");
    preview.src = item.sourceUrl;
    preview.alt = `Preview of ${item.file.name}`;

    const body = makeElement("div", "image-card-body");
    body.append(makeElement("p", "summary-kicker", "Selected image"));
    body.append(makeElement("p", "source-name", item.file.name || "Local image"));
    const facts = makeElement("dl", "file-facts");
    appendFact(facts, "Type", getMimeForFormat(item.format));
    appendFact(facts, "Size", formatBytes(item.file.size));
    appendFact(facts, "Dimensions", `${item.dimensions.width.toLocaleString()} × ${item.dimensions.height.toLocaleString()} px`);
    body.append(facts);
    appendMetadata(body, item.sourceScan);
    card.append(preview, body);
    selectedList.append(card);
  });
}

function clearResults() {
  resultUrls.forEach((url) => URL.revokeObjectURL(url));
  resultUrls = [];
  resultsList.replaceChildren();
  results.hidden = true;
  resultsSummary.textContent = "";
}

async function addFiles(fileList) {
  if (processing) return;
  clearFileError();
  clearResults();

  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;

  const available = MAX_BATCH_FILES - selectedItems.length;
  if (available <= 0) {
    showFileError(`The configured batch limit is ${MAX_BATCH_FILES} images.`);
    return;
  }

  const errors = [];
  const accepted = incoming.slice(0, available);
  setStatus(`Inspecting ${accepted.length} image${accepted.length === 1 ? "" : "s"} locally…`);

  for (const file of accepted) {
    try {
      const { format, dimensions, sourceScan } = await validateFile(file);
      selectedItems.push({ file, format, dimensions, sourceScan, sourceUrl: URL.createObjectURL(file) });
    } catch (error) {
      errors.push(`${file.name || "File"}: ${error instanceof Error ? error.message : "Could not inspect file."}`);
    }
  }

  if (incoming.length > available) errors.push(`Only ${available} additional files fit within the configured batch limit.`);
  renderSelected();
  if (errors.length) showFileError(errors.join(" "));
  setStatus(selectedItems.length ? `${selectedItems.length} image${selectedItems.length === 1 ? "" : "s"} ready to strip.` : "");
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the HTML image decoder.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw(context) { context.drawImage(image, 0, 0); },
      close() {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, mime, outputQuality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This browser could not encode the stripped image.")), mime, outputQuality);
  });
}

async function reencodeImage(file, mime, outputQuality) {
  const decoded = await decodeImage(file);
  try {
    validateDimensions({ width: decoded.width, height: decoded.height });
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d", { alpha: mime !== "image/jpeg" });
    if (!context) throw new Error("The browser could not create an image canvas.");

    if (mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (typeof decoded.draw === "function") decoded.draw(context);
    else context.drawImage(decoded, 0, 0);

    const blob = await canvasToBlob(canvas, mime, outputQuality);
    canvas.width = 1;
    canvas.height = 1;
    return blob;
  } finally {
    if (typeof decoded.close === "function") decoded.close();
  }
}

function requestedMime(item) {
  return outputFormat.value === "auto" ? getMimeForFormat(item.format) : outputFormat.value;
}

function renderResult(item, blob, scan) {
  const url = URL.createObjectURL(blob);
  resultUrls.push(url);
  const blocked = scan.markers.length > 0;
  const card = makeElement("article", `image-card result-card${blocked ? " is-blocked" : ""}`);
  const preview = makeElement("img", "preview-image");
  preview.src = url;
  preview.alt = `Preview of stripped ${item.file.name}`;

  const body = makeElement("div", "image-card-body");
  body.append(makeElement("p", "summary-kicker", "Stripped result"));
  body.append(makeElement("p", "source-name", item.file.name || "Local image"));
  const facts = makeElement("dl", "result-facts");
  appendFact(facts, "Output", blob.type);
  appendFact(facts, "Size", formatBytes(blob.size));
  appendFact(facts, "Removed source areas", item.sourceScan.markers.length ? item.sourceScan.markers.join(", ") : "No known marker detected before stripping");
  appendFact(facts, "Known source markers after", scan.markers.length ? scan.markers.join(", ") : "None detected");
  body.append(facts);

  if (blocked) {
    body.append(makeElement("p", "blocked-label", "Download blocked"));
    body.append(makeElement("p", "verification-copy", "A known source-metadata marker remains in the browser-generated export."));
  } else {
    body.append(makeElement("p", "clean-label", "Known source markers clean"));
    body.append(makeElement("p", "verification-copy", "No known EXIF, XMP, IPTC or embedded C2PA/JUMBF source marker was detected. Platform-side CR/C2PA matching still cannot be guaranteed."));
    const extension = FORMAT_TO_EXTENSION.get(blob.type) || "img";
    const link = makeElement("a", "button button-primary download-button", "Download stripped image");
    link.href = url;
    link.download = `${sanitizeBaseName(item.file.name)}-stripped.${extension}`;
    body.append(link);
  }

  card.append(preview, body);
  resultsList.append(card);
  return !blocked;
}

function setProcessing(value) {
  processing = value;
  stripButton.setAttribute("aria-disabled", String(value));
  resetButton.setAttribute("aria-disabled", String(value));
  heroUploadButton.setAttribute("aria-disabled", String(value));
}

async function processImages() {
  if (processing) return;
  clearFileError();

  if (!selectedItems.length) {
    showFileError("Choose at least one JPEG, PNG or WebP image first.");
    imageInput.focus();
    return;
  }

  setProcessing(true);
  clearResults();
  const outputQuality = Number(quality.value) / 100;
  let clean = 0;
  let failed = 0;

  try {
    for (let index = 0; index < selectedItems.length; index += 1) {
      const item = selectedItems[index];
      setStatus(`Stripping ${index + 1} of ${selectedItems.length}: ${item.file.name}`);

      try {
        const blob = await reencodeImage(item.file, requestedMime(item), outputQuality);
        const format = MIME_TO_FORMAT.get(blob.type);
        if (!format) throw new Error("The browser returned an unsupported output format.");
        const scan = await scanMetadata(blob, format);
        if (renderResult(item, blob, scan)) clean += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        const card = makeElement("article", "image-card result-card is-blocked");
        const body = makeElement("div", "image-card-body");
        body.append(makeElement("p", "summary-kicker", "Processing error"));
        body.append(makeElement("p", "source-name", item.file.name || "Local image"));
        body.append(makeElement("p", "blocked-label", error instanceof Error ? error.message : "This image could not be processed."));
        card.append(body);
        resultsList.append(card);
      }
    }

    results.hidden = false;
    resultsSummary.textContent = failed ? `${clean} CLEAN · ${failed} BLOCKED/FAILED` : `${clean} CLEAN`;
    setStatus(failed ? "Batch finished. Review blocked or failed items." : `${clean} image${clean === 1 ? "" : "s"} stripped successfully.`);
    resultsTitle.focus();
  } finally {
    setProcessing(false);
  }
}

function clearSelection() {
  selectedItems.forEach((item) => URL.revokeObjectURL(item.sourceUrl));
  selectedItems = [];
  selectedList.replaceChildren();
  selection.hidden = true;
  selectedCount.textContent = "";
}

function resetApp() {
  clearSelection();
  clearResults();
  clearFileError();
  imageInput.value = "";
  outputFormat.value = "auto";
  quality.value = "92";
  qualityValue.value = "92%";
  qualityValue.textContent = "92%";
  stripButton.textContent = "Strip metadata";
  setStatus("");
}

function openImagePicker() {
  if (processing) return;
  document.getElementById("stripper").scrollIntoView({ block: "start" });
  imageInput.click();
}

imageInput.addEventListener("change", () => {
  addFiles(imageInput.files);
  imageInput.value = "";
});

stripForm.addEventListener("submit", (event) => {
  event.preventDefault();
  processImages();
});

stripForm.addEventListener("reset", (event) => {
  if (processing) {
    event.preventDefault();
    return;
  }
  queueMicrotask(resetApp);
});

stripMoreButton.addEventListener("click", () => {
  resetApp();
  openImagePicker();
});

heroUploadButton.addEventListener("click", openImagePicker);

quality.addEventListener("input", () => {
  const label = `${quality.value}%`;
  qualityValue.value = label;
  qualityValue.textContent = label;
});

["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  if (!processing) dropZone.classList.add("is-dragover");
}));

["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragover");
}));

dropZone.addEventListener("drop", (event) => {
  if (!processing) addFiles(event.dataTransfer?.files);
});

window.addEventListener("beforeunload", () => {
  selectedItems.forEach((item) => URL.revokeObjectURL(item.sourceUrl));
  resultUrls.forEach((url) => URL.revokeObjectURL(url));
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
