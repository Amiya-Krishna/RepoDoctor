import { Router } from "express";
import { protect } from "../middleware/auth.middleware.js";
import { deleteMyData, getPrivacy, listAuditEvents, listNotifications, markNotificationsRead, putPrivacy } from "../controllers/privacy.controller.js";

const router = Router();
router.get("/", protect, getPrivacy);
router.put("/", protect, putPrivacy);
router.delete("/data", protect, deleteMyData);
router.get("/notifications", protect, listNotifications);
router.post("/notifications/read", protect, markNotificationsRead);
router.get("/audit", protect, listAuditEvents);
export default router;
