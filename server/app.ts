import "dotenv/config";
import express, { type Express } from "express";
import type { Server } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./_core/oauth";
import { registerStorageProxy } from "./_core/storageProxy";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { serveStatic, setupVite } from "./_core/vite";

export async function createApp(server?: Server): Promise<Express> {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  if (process.env.NODE_ENV === "development") {
    if (!server) throw new Error("A development HTTP server is required for Vite middleware");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  return app;
}
