import type { MiddlewareHandler } from "hono";
import { config } from "./config.js";

export const bearerAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  if (token !== config.webhookSecret) {
    return c.json({ error: "Invalid token" }, 401);
  }

  await next();
};
