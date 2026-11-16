# Snip

Snip is a tiny URL shortener with one backend and two clients: an Angular web
app and a Node.js CLI. The backend keeps links in memory, so restarting it
clears them.

## API contract

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/api/links` | `{ "url": "https://…" }` | `201` `{ code, url, shortUrl, hits, createdAt }`; `400` for invalid JSON or a non-HTTP(S) URL |
| `GET` | `/api/links` | — | `200` array of link objects |
| `GET` | `/:code` | — | `302` redirect and increment `hits`; `404` for an unknown code |

## Repository layout

Each component has its own orphan branch and keeps its files at the branch
root. `main` pins the component commits as Git submodules; `bundle` is generated
release output.

| Path | Branch | Contents |
| --- | --- | --- |
| `backend/` | `backend` | Zero-dependency Bun API server |
| `frontend/` | `frontend` | Angular 19 web app |
| `cli/` | `cli` | Zero-dependency Node.js CLI |
| `bundle/` | `bundle` | Generated API, CLI, and built web UI |

## Clone

Initialize all submodules when cloning; a plain clone leaves their directories
empty:

```sh
git clone --recurse-submodules https://github.com/chriswancw/workshop_day1.git
cd workshop_day1
```

## Run locally

Run each component in a separate terminal:

```sh
cd backend
bun start
```

```sh
cd frontend
npm install
npx ng serve
```

```sh
cd cli
node cli.js ls
```

The frontend development proxy sends `/api` requests to the backend on port
3000. The CLI uses `SNIP_API` or defaults to `http://localhost:3000`.

## Update workflow

Make and push component changes from their submodule directories. Then update
the corresponding pinned commit on `main`:

```sh
cd backend
git add -A
git commit -m "Describe backend change"
git push
cd ..
git submodule update --remote backend
git add backend
git commit -m "Bump backend submodule"
git push
```

After component updates, regenerate and publish the bundle with:

```sh
node scripts/build-bundle.mjs --push
```

`bundle/` is generated output: do not hand-edit it. The hourly/manual bundle
workflow runs dependency checks and tests, generates the bundle, and pushes
updated pointers. A change to the `bundle` submodule pointer on `main` triggers
the Docker workflow, which scans the image before publishing it to GHCR.
