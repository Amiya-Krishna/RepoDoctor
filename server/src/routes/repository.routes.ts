import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { listRepositories } from "../controllers/repository.controller";

const router = Router();

router.get("/", protect, listRepositories);

export default router;