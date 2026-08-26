# Meta-Stripper

**Strip Metadata off. Keep Image on.**

Meta-Stripper is a static, dependency-free Progressive Web App that re-encodes JPEG, PNG and WebP images entirely in the browser to remove source-level metadata and embedded provenance blocks.

## What it does

- Runs entirely client-side with plain HTML, CSS and JavaScript.
- Accepts one image or a batch of images.
- Shows detected source metadata for every selected image before stripping.
- Displays common readable EXIF details such as camera make/model, software, dates and the presence of GPS data when available.
- Decodes each image and draws only its visible pixels to a canvas.
- Creates a new JPEG, PNG or WebP file instead of copying the source container.
- Removes source EXIF/GPS, XMP, IPTC, comments and embedded C2PA/JUMBF blocks as a consequence of re-encoding.
- Scans every generated file for known source-metadata markers before enabling download.
- Processes batches sequentially to reduce peak memory pressure.
- Works offline after the app shell has been cached by the Service Worker.
- Uses no libraries, fonts, analytics, CDN assets, remote APIs or upload endpoint.

## Configure image and batch limits

All size limits live in [`config.js`](./config.js), so they can be changed without editing `app.js`:

```javascript
window.META_STRIPPER_CONFIG = Object.freeze({
  maxFileBytes: 30 * 1024 * 1024,
  maxPixels: 50_000_000,
  maxBatchFiles: 20,
  jpegHeaderScanBytes: 2 * 1024 * 1024,
});
```

- `maxFileBytes`: maximum source-file size per image.
- `maxPixels`: maximum decoded pixel count per image.
- `maxBatchFiles`: maximum number of images held in one batch.
- `jpegHeaderScanBytes`: maximum JPEG header bytes inspected when reading dimensions.

`config.js` is network-first in the Service Worker and is configured as `no-cache` in the supplied server examples, while a cached copy remains available offline.

## Batch workflow

1. Choose or drop one or more JPEG, PNG or WebP images.
2. Review the detected source metadata shown for each image.
3. Choose the output format and lossy quality.
4. Select **Strip metadata**.
5. Download each clean result.
6. Select **Strip more** to clear the current batch and open the image picker again.

The dancer icon in the hero area also opens the image picker directly.

## Important limitation: CR / C2PA cannot be guaranteed away everywhere

Meta-Stripper can remove **embedded** provenance data from the newly encoded file, but it cannot honestly guarantee that every platform will show no CR/C2PA indicator.

C2PA supports **soft bindings**. A platform or provenance service may use a perceptual fingerprint or an invisible watermark in the pixels to recover an externally stored Content Credential even after an embedded manifest has been removed.

Meta-Stripper intentionally does **not** modify image pixels in an attempt to defeat invisible watermarks, perceptual fingerprinting or provenance-recovery systems.

References:

- C2PA Content Credentials 2.4: https://spec.c2pa.org/specifications/specifications/2.4/specs/ContentCredentials.html
- LinkedIn Content Credentials help: https://www.linkedin.com/help/linkedin/answer/a6282984

## Privacy model

Selected images are held only in browser memory and local object URLs while the page is open.

Meta-Stripper does not:

- upload files;
- send metadata or filenames to a backend;
- use analytics or telemetry;
- load third-party JavaScript;
- cache user-selected images in the Service Worker.

The Content Security Policy restricts `connect-src` to the same origin, allowing the Service Worker to refresh static app files while blocking cross-origin connections.

## Security design

The app treats image files as untrusted input:

1. It checks the real file signature instead of trusting the extension alone.
2. It accepts only JPEG, PNG and WebP.
3. It validates configured file-size and decoded-pixel limits before decoding.
4. It processes batch files sequentially.
5. User-controlled filenames and metadata values are inserted with `textContent`, never `innerHTML`.
6. Object URLs are revoked when batches are cleared or the page unloads.
7. Every exported image is scanned for known source-metadata markers before download.
8. No third-party dependencies are present.
9. A restrictive CSP and additional security headers are supplied for Apache and Nginx.

The byte-level verification is deliberately described as a check for **known markers**, not a formal universal proof that a file contains zero metadata of every possible kind.

## Supported input

| Format | Input | Output |
|---|---:|---:|
| JPEG | Yes | Yes |
| PNG | Yes | Yes |
| WebP | Yes | Yes |
| SVG | No | No |
| HEIC/HEIF | No | No |
| AVIF | No | No |

## Deploy

No build step is required.

### Apache / common shared hosting

Upload the **contents** of this repository to the document root of the HTTPS hostname or subdomain. The included `.htaccess` adds the security headers and cache rules needed by the app.

### Nginx

Use `nginx-security-headers.conf` as a reference. Adapt the `location` paths if the app is mounted below `/`.

### Subdomain and subdirectory support

All browser-facing paths are relative (`./`), and the web manifest uses a relative `start_url`, `scope` and `id`.

Examples:

- `https://meta.example.com/`
- `https://example.com/meta-stripper/`

The Service Worker scope is the directory containing `sw.js`.

### HTTPS requirement

Service Workers and installable PWAs require a secure context. Deploy over HTTPS. `localhost` is the normal development exception.

### HSTS note

The supplied server examples use `Strict-Transport-Security: max-age=31536000`. They intentionally do **not** include `includeSubDomains` or `preload`.

## Local test

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

## PWA update behavior

The current Service Worker cache is `meta-stripper-v2`. Increment the cache name in `sw.js` when changing cached application assets in a later release.

## Project structure

```text
meta-stripper/
├── .htaccess
├── .gitignore
├── README.md
├── app.js
├── batch.css
├── config.js
├── index.html
├── manifest.webmanifest
├── nginx-security-headers.conf
├── robots.txt
├── styles.css
├── sw.js
└── assets/
    └── icon.svg
```

## No build, no package manager

There is no `package.json`, npm dependency tree or build output. What is in the repository is what is served.

## License

No license has been selected yet. Add the license you want before presenting the repository as open source.
