import { serve } from "@hono/node-server";
import { app } from "./server.js";
import { config } from "./config.js";
import { startWorker, stopWorker } from "./worker.js";

if (!config.webhookSecret) {
  console.error("[pi-queue] WEBHOOK_SECRET is required. Set it in your environment.");
  process.exit(1);
}

const hasDashboardUser = Boolean(config.dashboardUser);
const hasDashboardPassword = Boolean(config.dashboardPassword);
if (!hasDashboardUser || !hasDashboardPassword) {
  console.error(
    "[pi-queue] DASHBOARD_USER and DASHBOARD_PASSWORD are required."
  );
  process.exit(1);
}
if (!config.apiAccessToken) {
  console.error("[pi-queue] API_ACCESS_TOKEN is required.");
  process.exit(1);
}

console.log(`[pi-queue] Starting server on ${config.host}:${config.port}`);

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});

console.log(`[pi-queue] Server listening on http://${config.host}:${config.port}`);

// Start background worker
startWorker();

// Graceful shutdown
async function shutdown() {
  console.log("\n[pi-queue] Shutting down...");
  await stopWorker();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
