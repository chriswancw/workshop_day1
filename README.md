# Snip backend

Zero-dependency Bun 1.x URL shortener. Run `bun start` (port 3000) and `bun test`.
Links live in an in-memory Map: restarting clears all records. This workshop
service has open CORS and no authentication; it is not a persistent production store.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/links` | JSON `{ "url": "https://example.com" }` returns 201 link; invalid JSON or non-HTTP(S) URL returns 400 `{ error }` |
| GET | `/api/links` | 200 array of links |
| GET | `/:code` | 302 with `Location`, increments hits; unknown code returns 404 `{ error }` |
| OPTIONS | any | 204 CORS preflight |

A link is `{ code, url, shortUrl, hits, createdAt }`: six random base62 characters,
an absolute HTTP(S) URL, the configured-origin short URL, an initial hit count of
zero, and an ISO timestamp. Codes are case-sensitive; collisions are retried.
Unsupported methods return 405 `{ error }` with `Allow`; unknown API paths return 404.

Environment:

- `PORT`: integer 1-65535, default `3000`.
- `BASE_URL`: short-link origin; takes precedence over
  `https://$RAILWAY_PUBLIC_DOMAIN`, otherwise `http://localhost:$PORT`.
- `PUBLIC_DIR`: optional static directory, relative to the process working directory.
  `/` serves `index.html`; existing files take precedence over short codes.
  `/api` is reserved for API routes. Static paths cannot escape the configured
  directory, including through symlinks. Missing assets return 404, not an SPA fallback.
  HEAD requests return headers without incrementing hits.

Manual verification (PowerShell; do not follow the redirect during the hit check):

```powershell
bun start
# In another terminal:
$link = Invoke-RestMethod http://localhost:3000/api/links -Method Post -ContentType application/json -Body '{"url":"https://example.com"}'
Invoke-RestMethod http://localhost:3000/api/links
curl.exe -i "http://localhost:3000/$($link.code)"
Invoke-RestMethod http://localhost:3000/api/links
```

Expect 201 creation, 200 listing, 302 redirect, then `hits: 1`.

These files belong at the root of branch `backend`. The `main` superproject later
mounts this branch as a submodule. Commit and push backend changes first, then
update the pinned backend commit on `main`. The release builder copies `server.js`
unchanged into generated `bundle` output; do not hand-edit that output.
