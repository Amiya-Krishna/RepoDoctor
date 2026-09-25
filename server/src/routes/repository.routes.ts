import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { listRepositories } from "../controllers/repository.controller";
import { ingest } from "../controllers/ingestion.controller";
import { getRepositoryAnalyses } from "../controllers/analysis.controller";

const router = Router();

router.get("/", protect, listRepositories);
router.post("/ingest", protect, ingest);
router.get("/:repositoryId/analyses", protect, getRepositoryAnalyses);
export default router;