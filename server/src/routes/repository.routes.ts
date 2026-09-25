import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { ingest } from "../controllers/ingestion.controller";
import { getRepositoryAnalyses } from "../controllers/analysis.controller";
import { listRepositories, getRepository } from "../controllers/repository.controller";
import { getLatestAnalysis } from "../controllers/analysis.controller";

const router = Router();

router.get("/", protect, listRepositories);
router.get("/:repositoryId/analyses", protect, getRepositoryAnalyses);
router.post("/ingest", protect, ingest);
router.get("/:repositoryId", protect, getRepository);
router.get("/:repositoryId/analysis/latest", protect, getLatestAnalysis);

export default router;