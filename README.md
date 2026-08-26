# Meta-Stripper

**Take it all off. Metadata only.**

Meta-Stripper is a static, dependency-free Progressive Web App that re-encodes JPEG, PNG and WebP images entirely in the browser to remove source-level metadata and embedded provenance blocks from the exported file.

## What it does

- Runs entirely client-side with plain HTML, CSS and JavaScript.
- Decodes the selected image and draws only the visible pixels to a canvas.
- Creates a new JPEG, PNG or WebP file instead of copying the original container.
- Removes source EXIF/GPS, XMP, IPTC, comments and embedded C2PA/JUMBF blocks as a consequence of re-encoding.
- Scans the generated file for known source-metadata markers before enabling download.
- Rejects SVG and files whose real signature does not match a supported raster format.
- Enforces a 30 MB input limit and a 50-megapixel decoded-size limit.
- Works offline after the app shell has been cached by the Service Worker.
- Uses no libraries, fonts, analytics, CDN assets, remote APIs or upload endpoint.

## Important limitation: CR / C2PA cannot be guaranteed away everywhere

Meta-Stripper can remove **embedded** provenance data from the newly encoded file, but it cannot honestly guarantee that every platform will show no CR/C2PA indicator.

C2PA supports **soft bindings**. A platform or provenance service may use a perceptual fingerprint or an invisible watermark in the pixels to recover an externally stored Content Credential even after an embedded manifest has been removed.

Meta-Stripper intentionally does **not** modify image pixels in an attempt to defeat invisible watermarks, perceptual fingerprinting or provenance-recovery systems.

References:

- C2PA Content Credentials 2.4: https://spec.c2pa.org/specifications/specifications/2.4/specs/ContentCredentials.html
- LinkedIn Content Credentials help: https://www.linkedin.com/help/linkedin/answer/a6282984

## Privacy model

The selected image is held only in browser memory and local object URLs while the page is open.

Meta-Stripper does not:

- upload the selected file;
- send metadata or filenames to a backend;
- use analytics or telemetry;
- load third-party JavaScript;
- cache user-selected images in the Service Worker.

The Content Security Policy restricts `connect-src` to the same origin so the Service Worker can refresh the static app shell while cross-origin connections remain blocked.

## Security design

The app treats image files as untrusted input:

1. It checks the real file signature instead of trusting the extension alone.
2. It accepts only JPEG, PNG and WebP.
3. It rejects files above 30 MB.
4. It reads dimensions before full decoding where possible and rejects images above 50 megapixels.
5. User-controlled filenames are inserted with `textContent`, never `innerHTML`.
6. Object URLs are revoked when replaced or when the page unloads.
7. The exported image is scanned for known source-metadata markers before download.
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

The browser may fall back to PNG if it does not support the requested encoder. Meta-Stripper detects the actual returned MIME type.

## Deploy

No build step is required.

### Apache / common shared hosting

Upload the **contents** of this repository to the document root of the HTTPS hostname or subdomain.

The included `.htaccess`:

- disables directory listing;
- adds a strict CSP;
- adds clickjacking, MIME-sniffing, referrer, permissions, COOP and CORP protections;
- enables HSTS for the current hostname;
- prevents aggressive caching of `sw.js`.

If your host does not allow `Header` directives, reproduce the headers in the host/CDN control panel.

### Nginx

Use `nginx-security-headers.conf` as a reference and adapt the two `location` paths if the app is not mounted at `/`.

### Subdomain and subdirectory support

All browser-facing paths in the application are relative (`./`), and the web manifest uses a relative `start_url`, `scope` and `id`. The PWA can therefore be served from:

- `https://meta.example.com/`
- `https://example.com/meta-stripper/`

The Service Worker scope is the directory containing `sw.js`.

### HTTPS requirement

Service Workers and installable PWAs require a secure context. Deploy over HTTPS. `localhost` is the normal development exception.

### HSTS note

The supplied configuration uses:

```text
Strict-Transport-Security: max-age=31536000
```

It intentionally does **not** include `includeSubDomains` or `preload`. Add those only after confirming that every affected hostname is permanently HTTPS.

## Local test

Any local static HTTP server is enough for normal UI testing. Service Worker behavior works on `localhost`.

Example with Python:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

## PWA update behavior

The Service Worker cache is currently:

```text
meta-stripper-v1
```

When changing cached assets for a release, increment the cache name in `sw.js` so old app-shell caches are removed on activation.

## Release checks

Before publishing a release:

- Test JPEG, PNG and WebP source images with EXIF/XMP/C2PA data.
- Verify an offline reload after one successful online visit.
- Test keyboard-only navigation and visible focus.
- Test VoiceOver/NVDA/TalkBack on the deployed version where possible.
- Run Lighthouse against the real HTTPS hostname.
- Check the deployed headers with browser DevTools or a security-header scanner.
- Verify installability on Android/Chromium and iOS/Safari.
- Confirm that `sw.js` is served as JavaScript and is not cached for a long period.

## Project structure

```text
meta-stripper/
├── .htaccess
├── .gitignore
├── README.md
├── app.js
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

There is no `package.json`, no npm dependency tree and no build output. What you see in the repository is what is served.

## License

No license has been selected yet. Add the license you want before presenting the repository as open source.
