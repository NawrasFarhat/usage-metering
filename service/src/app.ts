import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { adminRouter } from "./routes/admin.js";
import { accountRouter } from "./routes/account.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/admin", adminRouter);
  app.use("/v1", accountRouter);

  app.use(errorHandler); 
  return app;
}