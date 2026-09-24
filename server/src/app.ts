import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import githubRoutes from "./routes/github.routes";
import repositoryRoutes from "./routes/repository.routes";

const app = express();

app.use(cors());
app.use(express.json());

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

export default app;