import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import githubRoutes from "./routes/github.routes.js";
import repositoryRoutes from "./routes/repository.routes.js";
import repairRoutes from "./routes/repair.routes.js";
import {
  apiRateLimiter,
  authRateLimiter,
} from "./middleware/rate-limit.middleware.js";

const app = express();

// Behind a reverse proxy (e.g. the bundled nginx) every client would otherwise
// share the proxy's IP in rate limiting. Opt in with TRUST_PROXY=<hop count>.
const trustProxyHops = Number(process.env.TRUST_PROXY ?? 0);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

// Order matters: CORS first (so preflight requests are not rate limited and
// error responses carry CORS headers), then rate limiting, then body parsing.
app.use(cors({
  origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
  credentials: true,
}));
app.use("/api", apiRateLimiter);
app.use(express.json({
  verify: (req, _res, buffer) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "RepoDoctor API is running",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRateLimiter, authRoutes);
app.use("/api/github", githubRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/repairs", repairRoutes);

export default app;