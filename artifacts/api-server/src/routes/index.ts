import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ideaStreamRouter from "./idea-stream";
import searchRouter from "./search";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ideaStreamRouter);
router.use(searchRouter);
router.use(storageRouter);

export default router;
