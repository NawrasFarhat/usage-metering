import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";

// Builds the Express app without starting it, so tests can use it directly.
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(errorHandler); // must be registered last
  return app;
}