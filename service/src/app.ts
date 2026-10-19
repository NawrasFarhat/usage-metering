import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAccount } from "./middleware/auth.js";
import { NotFoundError } from "./errors.js";
import { adminRouter } from "./routes/admin.js";
import { accountRouter } from "./routes/account.js";

// Builds the Express app without starting it, so tests can use it directly.
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/admin", adminRouter);

  // Every /v1 route needs an API key. Checked once here, so a new route can't forget it.
  const v1 = express.Router();
  v1.use(requireAccount);
  v1.use(accountRouter);
  app.use("/v1", v1);

  // Any other path -> 404 in our error format
  app.use((_req, _res) => {
    throw new NotFoundError("Route not found");
  });

  app.use(errorHandler);
  return app;
}