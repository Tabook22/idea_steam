import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ideaStreamRouter from "./idea-stream";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ideaStreamRouter);

export default router;
