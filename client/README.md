# RepoDoctor AI — Client

React 19 + TypeScript + Vite single-page app for [RepoDoctor AI](../README.md). This file replaces the unmodified Vite template text that used to be here. Nothing below was executed during the documentation audit (no `npm install` was run).

## Scripts (`package.json`)

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (default `http://localhost:5173`) |
| `npm run build` | `tsc -b && vite build` |
| `npm run lint` | `eslint .` |
| `npm run preview` | serve the production build |

There are no client tests.

## Configuration

`VITE_API_URL` (see `.env.example`) is the API base URL, default `http://localhost:5000/api`. The Docker build (`client/Dockerfile`) sets it to `/api` and serves the build with nginx, which proxies `/api/` to `http://server:4000/api/`. The socket connection is made to the same origin with `/api` removed.

## What the UI does (source inspection)

- `src/App.tsx` — register/login form, token in `localStorage`, "Connect GitHub" button, logout.
- `src/pages/Repositories.tsx` — repository list, scan trigger, job polling through `GET /repositories/jobs/:jobId`, Socket.IO `scan:*` events, repository deletion.
- `src/pages/RepositoryAnalysis.tsx` — latest analysis, findings and risk, a test-command field (default `npm test`), repair trigger (`POST /repairs`), Socket.IO `repair:*` events, pull-request link when one exists, explicit message when no PR was created.
- `src/pages/AnalysisHistory.tsx` — list of past analyses.
- `src/lib/api.ts`, `src/lib/auth.ts`, `src/services/repository.service.ts`, `src/types/repository.ts` — axios instance, auth header, API calls, types.

## Known gaps

No router, no tests, no accessibility review, no REST polling fallback for repair status, token kept in `localStorage`, template images (`src/assets/`) are not product screenshots.
