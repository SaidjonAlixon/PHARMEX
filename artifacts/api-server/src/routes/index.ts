import { Router, type IRouter } from "express";
import healthRouter from "./health";
import identityRouter from "./identity";
import branchesRouter from "./branches";
import dashboardRouter from "./dashboard";
import tradeRouter from "./trade";
import financeRouter from "./finance";
import reportsRouter from "./reports";
import fomRouter from "./fom";
import { requireClerkUser } from "../middlewares/requireClerkUser";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireClerkUser);
router.use(identityRouter);
router.use(branchesRouter);
router.use(dashboardRouter);
router.use(tradeRouter);
router.use(financeRouter);
router.use(reportsRouter);
router.use(fomRouter);

export default router;
