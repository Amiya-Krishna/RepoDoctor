import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { listRepositories } from "../controllers/repository.controller";
import { ingest } from "../controllers/ingestion.controller";

const router = Router();

router.get("/", protect, listRepositories);
router.post("/ingest", protect, ingest);

export default router;