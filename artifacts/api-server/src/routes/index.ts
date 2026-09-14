import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ideaStreamRouter from "./idea-stream";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ideaStreamRouter);
router.use(storageRouter);

export default router;
