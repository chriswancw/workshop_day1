# Snip frontend

Angular 19 client for Snip's shared backend. This branch is an independent component:
files live at its root, and `main` later mounts this branch as the `frontend` submodule.

## Run

Use Node 20+ (an Angular 19-supported release) and npm. Run the backend on port 3000,
then `npm ci` and `npm start` here. Open http://localhost:4200.
The development server proxies `/api` to http://127.0.0.1:3000 via `proxy.conf.json`.
An explicit IPv4 loopback avoids resolving localhost to an unrelated IPv6 listener.
If another service uses localhost:3000, set backend `BASE_URL=http://127.0.0.1:3000`
so generated short links also reach Snip.
Requests stay same-origin in the built app, so the generated bundle can serve the
UI and API together on any deployment host without rebuilding a localhost URL.

## Contract and behavior

- `POST /api/links` sends `{ "url": "https://..." }`; 201 returns
  `{ code, url, shortUrl, hits, createdAt }`, and 400 returns `{ error }`.
- `GET /api/links` returns an array of the same records.
- Links use the server-provided `shortUrl`; `GET /:code` redirects and adds one hit.

The reactive form validates HTTP(S) URLs, blocks duplicate pending submissions,
and shows server/network errors beside the field. Successful creation displays
the short link and reloads the table. The table loads on startup and through
Refresh links; use that action after opening a link to see updated hits.
List failures retain previous rows with an explicit stale-data notice.
Storage is in memory on the backend, so restarting it clears the list.

## Verify and build

- `npx ng build` must produce `dist/snip-frontend/browser/index.html`.
  Do not rename the project or change this output path: the release script uses it.
- `npm test -- --watch=false --browsers=ChromeHeadless` runs component and HTTP tests.
  Set `CHROME_BIN` to a Chrome/Chromium executable if it is not discovered.
- With both servers running, create a URL through the UI, open its short link,
  refresh the table, and confirm the hit count increases. Check mobile layout,
  keyboard focus, inline validation, empty state, and unreachable-backend errors.

Commit and push changes on `frontend`, then update the pinned frontend commit on
`main`. Never hand-edit the generated `bundle` branch.
