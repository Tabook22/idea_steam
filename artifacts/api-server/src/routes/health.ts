import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { aiConfigured } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();
router.get("/capabilities", (_req, res) => {
  res.json({ ai: aiConfigured });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
