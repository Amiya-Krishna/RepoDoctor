import { Router } from "express";
import { protect } from "../middleware/auth.middleware.js";
import {
  approveRepair, getRepairQueueStatus, getRepairReport, listRepairs, queueRepair, rejectRepair, revokeApproval,
} from "../controllers/repair.controller.js";

const router = Router();

router.post("/", protect, queueRepair);
router.get("/", protect, listRepairs);
router.get("/jobs/:jobId", protect, getRepairQueueStatus);
router.get("/:repairJobId", protect, getRepairReport);
router.post("/:repairJobId/approve", protect, approveRepair);
router.post("/:repairJobId/reject", protect, rejectRepair);
router.post("/:repairJobId/revoke-approval", protect, revokeApproval);

export default router;
