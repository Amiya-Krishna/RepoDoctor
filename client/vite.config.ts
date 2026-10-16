import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Same public address as the Docker stack: http://localhost:8080.
// In Docker, nginx serves the build on 8080 and proxies /api and /socket.io to
// server:4000. Here the Vite dev/preview server does exactly the same, proxying
// to the API started with `npm run dev` in server/ (PORT=4000). Override the
// target with API_PROXY_TARGET if the API runs elsewhere.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000'

const proxy = {
  '/api': { target: apiTarget },
  '/socket.io': { target: apiTarget, ws: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // strictPort: fail loudly (instead of silently moving to 8081) when the
  // Docker stack or another process already holds 8080.
  server: { port: 8080, strictPort: true, proxy },
  preview: { port: 8080, strictPort: true, proxy },
})
