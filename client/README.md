# RepoDoctor AI — Client

React 19 + TypeScript + Vite single-page app for [RepoDoctor AI](../README.md).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (default `http://localhost:5173`) |
| `npm run build` | `tsc -b && vite build` |
| `npm run lint` | `eslint .` |
| `npm run preview` | serve the production build |
| `npm run test:e2e` | Playwright browser tests for registration/login (see below) |

There are no unit tests for the client. Registration and login are covered by Playwright browser tests in `e2e/auth.spec.ts`: `npm run test:e2e` against a running API and client (first time: `npx playwright install chromium`; set `E2E_BASE_URL` if the client is not on `http://localhost:5173`, and `PLAYWRIGHT_CHROMIUM_PATH` to use an existing Chromium). Each run registers a unique `rd_e2e_<timestamp>@example.test` user and never touches existing accounts. Point the API at a Neon branch, not your main database.

## Configuration

`VITE_API_URL` is the API base URL, default `http://localhost:5000/api`. Vite reads it at **build time** and embeds it in the bundle (checked: building with `VITE_API_URL=https://api.example.test/api` embeds that URL; building without it embeds `http://localhost:5000/api`), so a hosted build must set it before building and be redeployed when it changes. It must end in `/api` because the Socket.IO origin is derived by removing that suffix. The Docker build (`client/Dockerfile`) sets it to `/api` and serves the build with nginx, which proxies `/api/` and `/socket.io/` to `http://server:4000`. The Socket.IO connection uses the same origin with `/api` removed.

## Building and deploying

`npm ci && npm run lint && npm run build` writes the static site to `client/dist`. When a host builds from the GitHub repository, set its root directory to `client`, build command `npm run build`, output directory `dist`, Node 22, the `VITE_API_URL` variable, and an SPA rewrite to `/index.html`. The API must be hosted separately and allow the frontend origin through `FRONTEND_URL`. Full steps and the symptom table: [root README, Deploying the frontend](../README.md#deploying-the-frontend-and-connecting-the-github-repository).

## What the UI does

- **Authentication** (`src/components/AuthForm.tsx`): login / register form with labelled fields, inline validation that mirrors the server rules, a show/hide password toggle, a disabled submit while a request is in flight, and server error messages. The JWT is stored in `localStorage`.
- **Session handling** (`src/App.tsx`, `src/lib/api.ts`): a stored token is validated with `GET /auth/me` on load; any `401` on an authenticated request clears the token and returns to the login form with a notice.
- **Repositories** (`src/pages/Repositories.tsx`): connect GitHub, refresh and list repositories, queue scans, show live scan progress over Socket.IO, view the latest analysis and history, remove a repository (with confirmation). A user without a GitHub connection sees a prompt to connect instead of an error.
- **Analysis views** (`src/pages/RepositoryAnalysis.tsx`, `AnalysisHistory.tsx`): findings, risk and history for a repository.

Styling is a single stylesheet (`src/index.css`) with light and dark themes and a responsive layout.
