import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ideaStreamRouter from "./idea-stream";
import audioLibraryRouter from "./audio-library";
import searchRouter from "./search";
import askRouter from "./ask";
import dashboardRouter from "./dashboard";
import tasksRouter from "./tasks";
import connectionsRouter from "./connections";
import meetingsRouter from "./meetings";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ideaStreamRouter);
router.use(searchRouter);
router.use(askRouter);
router.use(dashboardRouter);
router.use(tasksRouter);
router.use(connectionsRouter);
router.use(meetingsRouter);
router.use(audioLibraryRouter);
router.use(storageRouter);

export default router;
