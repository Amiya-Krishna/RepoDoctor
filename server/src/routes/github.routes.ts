import { Router } from "express";
import {
  connectGitHub,
  githubCallback,
  getRepositories,
} from "../controllers/github.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { handleGitHubWebhook } from "../controllers/github-webhook.controller.js";

const router = Router();

// GitHub webhook authentication is performed using the HMAC signature, not a user JWT.
router.post("/webhook", handleGitHubWebhook);

router.get("/connect", protect, connectGitHub);

router.get("/callback", githubCallback);

router.get("/repositories", protect, getRepositories);

export default router;