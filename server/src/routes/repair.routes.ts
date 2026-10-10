import { Router } from "express";
import { protect } from "../middleware/auth.middleware.js";
import { getRepairQueueStatus, queueRepair } from "../controllers/repair.controller.js";

const router = Router();

router.post("/", protect, queueRepair);
router.get("/jobs/:jobId", protect, getRepairQueueStatus);

export default router;
