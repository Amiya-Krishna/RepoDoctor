import { Router } from "express";
import {
  connectGitHub,
  githubCallback,
  getRepositories,
} from "../controllers/github.controller";
import { protect } from "../middleware/auth.middleware";

const router = Router();

router.get("/connect", protect, connectGitHub);

router.get("/callback", githubCallback);

router.get("/repositories", protect, getRepositories);

export default router;