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

// Register before your route handlers.
app.use("/api", apiRateLimiter);

// Apply only to your actual login/register router.
// Replace authRouter with the router name in your project.
app.use("/api/auth", authRateLimiter, authRoutes);

app.use(cors({
  origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
  credentials: true,
}));
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

app.use("/api/auth", authRoutes);
app.use("/api/github", githubRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/repairs", repairRoutes);

export default app;