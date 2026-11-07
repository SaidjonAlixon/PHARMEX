import { existsSync } from "node:fs";
import path from "node:path";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { assertLocalAuthConfig, localAuthEnabled } from "./lib/localAuth";
import { BusinessError } from "./lib/ledger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (localAuthEnabled) {
  assertLocalAuthConfig();
  app.use(cookieParser());
} else {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

app.use("/api", router);

// Production: the API also serves the built web app (dev uses the Vite server). Run from artifacts/api-server.
const webDir = process.env.WEB_DIST_DIR?.trim() || path.resolve(process.cwd(), "../dorixona-moliya/dist/public");
if (existsSync(path.join(webDir, "index.html"))) {
  app.use("/assets", express.static(path.join(webDir, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(webDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(webDir, "index.html"));
  });
  logger.info({ webDir }, "Serving web app");
}

app.use(
  (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (error instanceof BusinessError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unhandled request error");
    res.status(500).json({ error: "Serverda kutilmagan xatolik yuz berdi." });
  },
);

export default app;
