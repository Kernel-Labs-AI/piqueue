import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { basicAuth } from "hono/basic-auth";
import { serveStatic } from "@hono/node-server/serve-static";
import { api } from "./routes/api.js";
import { ui } from "./routes/ui.js";
import { config } from "./config.js";

const app = new Hono();

app.use(
  "/assets/*",
  serveStatic({
    root: config.isDev ? "./public" : "./dist/public",
    rewriteRequestPath: (path) => path.replace(/^\/assets/, ""),
  })
);

// Basic auth for dashboard (skip API routes)
app.use("*", async (c, next) => {
  // API routes handle their own auth (bearer token and/or basic fallback).
  if (c.req.path.startsWith("/api/")) {
    return next();
  }

  const auth = basicAuth({
    username: config.dashboardUser,
    password: config.dashboardPassword,
  });

  return auth(c, next);
});

// Error handling — let 401s from basicAuth pass through as proper responses
app.onError((err, c) => {
  if (err instanceof HTTPException && err.status === 401) {
    return err.getResponse();
  }

  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Mount routes
app.route("/api", api);
app.route("/", ui);

export { app };
