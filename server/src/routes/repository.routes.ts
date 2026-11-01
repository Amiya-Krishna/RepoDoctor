import { Router } from "express";
import { protect } from "../middleware/auth.middleware.js";
import { ingest, getScanJobStatus } from "../controllers/ingestion.controller.js";
import { getRepositoryAnalyses } from "../controllers/analysis.controller.js";
import { listRepositories, getRepository, deleteRepository, setAutoScan } from "../controllers/repository.controller.js";
import { getLatestAnalysis } from "../controllers/analysis.controller.js";

const router = Router();

router.get("/", protect, listRepositories);
router.get("/jobs/:jobId", protect, getScanJobStatus);
router.get("/:repositoryId/analyses", protect, getRepositoryAnalyses);
router.post("/ingest", protect, ingest);
router.get("/:repositoryId", protect, getRepository);
router.delete("/:repositoryId", protect, deleteRepository);
router.put("/:repositoryId/auto-scan", protect, setAutoScan);
router.get("/:repositoryId/analysis/latest", protect, getLatestAnalysis);

export default router;