import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const databasePaths: string[] = [];

function cleanupDbFiles(databasePath: string): void {
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
}

async function bootApp(options?: { publicOrigin?: string; flyAppName?: string }) {
  vi.resetModules();

  const databasePath = join(tmpdir(), `pi-queue-api-security-${randomUUID()}.db`);
  databasePaths.push(databasePath);

  process.env.NODE_ENV = "test";
  process.env.WEBHOOK_SECRET = "test-secret";
  process.env.API_ACCESS_TOKEN = "test-api-token";
  process.env.DATABASE_PATH = databasePath;
  process.env.DASHBOARD_USER = "test-dashboard";
  process.env.DASHBOARD_PASSWORD = "test-password";

  if (options?.publicOrigin === undefined) {
    delete process.env.PUBLIC_ORIGIN;
  } else {
    process.env.PUBLIC_ORIGIN = options.publicOrigin;
  }

  if (options?.flyAppName === undefined) {
    delete process.env.FLY_APP_NAME;
  } else {
    process.env.FLY_APP_NAME = options.flyAppName;
  }

  const [serverModule, dbModule, schemaModule] = await Promise.all([
    import("../server.js"),
    import("../db/index.js"),
    import("../db/schema.js"),
  ]);

  return {
    app: serverModule.app,
    db: dbModule.db,
    tasks: schemaModule.tasks,
    databasePath,
  };
}

function insertPendingTask(
  db: Awaited<ReturnType<typeof bootApp>>["db"],
  tasks: Awaited<ReturnType<typeof bootApp>>["tasks"],
  id: string
): void {
  const now = new Date().toISOString();
  db.insert(tasks)
    .values({
      id,
      title: `Task ${id}`,
      prompt: "Do work",
      status: "pending",
      priority: 0,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe.sequential("API security hardening", () => {
  afterEach(() => {
    for (const databasePath of databasePaths) {
      cleanupDbFiles(databasePath);
    }
    databasePaths.length = 0;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.FLY_APP_NAME;
    delete process.env.API_ACCESS_TOKEN;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.DASHBOARD_USER;
    delete process.env.DASHBOARD_PASSWORD;
  });

  it("rejects API reads without Authorization", async () => {
    const { app } = await bootApp({ publicOrigin: "https://pi-queue.fly.dev" });

    const response = await app.request(
      new Request("https://pi-queue.fly.dev/api/tasks")
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain("Authorization");
  });

  it("accepts approve when Origin matches PUBLIC_ORIGIN", async () => {
    const { app, db, tasks } = await bootApp({ publicOrigin: "https://pi-queue.fly.dev" });
    insertPendingTask(db, tasks, "approve-origin-match");

    const response = await app.request(
      new Request("https://pi-queue.fly.dev/api/tasks/approve-origin-match/approve", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-token",
          Origin: "https://pi-queue.fly.dev",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("approved");
  });

  it("rejects state change when Origin mismatches PUBLIC_ORIGIN", async () => {
    const { app, db, tasks } = await bootApp({ publicOrigin: "https://pi-queue.fly.dev" });
    insertPendingTask(db, tasks, "approve-origin-mismatch");

    const response = await app.request(
      new Request("https://pi-queue.fly.dev/api/tasks/approve-origin-mismatch/approve", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-token",
          Origin: "https://evil.example",
        },
      })
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("Cross-origin");
  });

  it("accepts Referer when Origin is missing and referer origin matches", async () => {
    const { app, db, tasks } = await bootApp({ publicOrigin: "https://pi-queue.fly.dev" });
    insertPendingTask(db, tasks, "approve-referer-match");

    const response = await app.request(
      new Request("https://pi-queue.fly.dev/api/tasks/approve-referer-match/approve", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-token",
          Referer: "https://pi-queue.fly.dev/tasks/approve-referer-match",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("approved");
  });

  it("accepts proxied requests when PUBLIC_ORIGIN matches browser Origin", async () => {
    const { app, db, tasks } = await bootApp({ publicOrigin: "https://public-host.example" });
    insertPendingTask(db, tasks, "approve-proxy-regression");

    const response = await app.request(
      new Request("http://internal-service.local/api/tasks/approve-proxy-regression/approve", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-token",
          Origin: "https://public-host.example",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("approved");
  });

  it("does not emit rate-limit headers and allows repeated webhook calls", async () => {
    const { app } = await bootApp({ publicOrigin: "https://pi-queue.fly.dev" });

    const firstResponse = await app.request(
      new Request("http://internal-service.local/api/tasks", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Task 0",
          prompt: "Prompt 0",
        }),
      })
    );

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.headers.get("X-RateLimit-Limit")).toBeNull();
    expect(firstResponse.headers.get("X-RateLimit-Remaining")).toBeNull();
    expect(firstResponse.headers.get("X-RateLimit-Reset")).toBeNull();
    expect(firstResponse.headers.get("Retry-After")).toBeNull();

    for (let i = 1; i < 40; i += 1) {
      const response = await app.request(
        new Request("http://internal-service.local/api/tasks", {
          method: "POST",
          headers: {
            Authorization: "Bearer test-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: `Task ${i}`,
            prompt: `Prompt ${i}`,
          }),
        })
      );
      expect(response.status).toBe(201);
    }
  });

  it("infers origin from FLY_APP_NAME when PUBLIC_ORIGIN is unset", async () => {
    const { app, db, tasks } = await bootApp({ flyAppName: "pi-queue-inferred" });
    insertPendingTask(db, tasks, "approve-fly-inferred-origin");

    const response = await app.request(
      new Request("http://internal-service.local/api/tasks/approve-fly-inferred-origin/approve", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-token",
          Origin: "https://pi-queue-inferred.fly.dev",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("approved");
  });
});
