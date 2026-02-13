import { randomUUID } from "crypto";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

type AppFixture = {
  app: {
    request: (input: Request | string, init?: RequestInit) => Promise<Response> | Response;
  };
  db: any;
  tasks: any;
  taskEvents: any;
  databasePath: string;
};

const databasePaths: string[] = [];

function cleanupDbFiles(databasePath: string): void {
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
}

async function bootApp(): Promise<AppFixture> {
  vi.resetModules();

  const databasePath = join(tmpdir(), `pi-queue-api-events-${randomUUID()}.db`);
  databasePaths.push(databasePath);

  process.env.NODE_ENV = "test";
  process.env.WEBHOOK_SECRET = "test-secret";
  process.env.API_ACCESS_TOKEN = "test-api-token";
  process.env.DATABASE_PATH = databasePath;
  delete process.env.DASHBOARD_USER;
  delete process.env.DASHBOARD_PASSWORD;
  delete process.env.PUBLIC_ORIGIN;
  delete process.env.FLY_APP_NAME;

  const [serverModule, dbModule, schemaModule] = await Promise.all([
    import("../server.js"),
    import("../db/index.js"),
    import("../db/schema.js"),
  ]);

  return {
    app: serverModule.app,
    db: dbModule.db,
    tasks: schemaModule.tasks,
    taskEvents: schemaModule.taskEvents,
    databasePath,
  };
}

function insertTask(fixture: AppFixture, id: string): void {
  const now = new Date().toISOString();
  fixture.db.insert(fixture.tasks)
    .values({
      id,
      title: `Task ${id}`,
      prompt: "Do work",
      status: "running",
      priority: 0,
      source: "manual",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
    })
    .run();
}

function insertEvent(
  fixture: AppFixture,
  input: {
    taskId: string;
    seq: number;
    eventType: string;
    payload: string;
    stream?: "rpc" | "stdout_raw" | "stderr";
    textDelta?: string | null;
  }
): void {
  fixture.db.insert(fixture.taskEvents)
    .values({
      taskId: input.taskId,
      seq: input.seq,
      stream: input.stream ?? "rpc",
      eventType: input.eventType,
      payload: input.payload,
      textDelta: input.textDelta ?? null,
      createdAt: new Date().toISOString(),
    })
    .run();
}

describe.sequential("API task events route", () => {
  afterEach(() => {
    while (databasePaths.length > 0) {
      const databasePath = databasePaths.pop();
      if (databasePath) cleanupDbFiles(databasePath);
    }
    delete process.env.DATABASE_PATH;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.FLY_APP_NAME;
    delete process.env.API_ACCESS_TOKEN;
    delete process.env.DASHBOARD_USER;
    delete process.env.DASHBOARD_PASSWORD;
  });

  it("returns events ordered by seq ascending and supports limit/offset", async () => {
    const fixture = await bootApp();
    const taskId = "events-ordering";
    insertTask(fixture, taskId);
    insertEvent(fixture, { taskId, seq: 2, eventType: "tool_execution_update", payload: "{\"step\":2}" });
    insertEvent(fixture, { taskId, seq: 1, eventType: "tool_execution_start", payload: "{\"step\":1}" });
    insertEvent(fixture, { taskId, seq: 3, eventType: "tool_execution_end", payload: "{\"step\":3}" });

    const fullResponse = await fixture.app.request(
      new Request(`http://events.example/api/tasks/${taskId}/events`, {
        headers: { Authorization: "Bearer test-api-token" },
      })
    );
    expect(fullResponse.status).toBe(200);
    const fullBody = await fullResponse.json();
    expect(fullBody.map((event: any) => event.seq)).toEqual([1, 2, 3]);

    const pagedResponse = await fixture.app.request(
      new Request(`http://events.example/api/tasks/${taskId}/events?limit=2&offset=1`, {
        headers: { Authorization: "Bearer test-api-token" },
      })
    );
    expect(pagedResponse.status).toBe(200);
    const pagedBody = await pagedResponse.json();
    expect(pagedBody.map((event: any) => event.seq)).toEqual([2, 3]);
  });

  it("parses JSON payloads and falls back to raw payload text when invalid JSON", async () => {
    const fixture = await bootApp();
    const taskId = "events-payload";
    insertTask(fixture, taskId);
    insertEvent(fixture, {
      taskId,
      seq: 1,
      eventType: "rpc",
      payload: "{\"ok\":true,\"message\":\"hello\"}",
    });
    insertEvent(fixture, {
      taskId,
      seq: 2,
      eventType: "stdout_raw",
      payload: "not-json",
      stream: "stdout_raw",
    });

    const response = await fixture.app.request(
      new Request(`http://events.example/api/tasks/${taskId}/events`, {
        headers: { Authorization: "Bearer test-api-token" },
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body[0].payload).toEqual({ ok: true, message: "hello" });
    expect(body[1].payload).toBe("not-json");
  });

  it("returns 404 when task does not exist", async () => {
    const fixture = await bootApp();
    const response = await fixture.app.request(
      new Request("http://events.example/api/tasks/missing/events", {
        headers: { Authorization: "Bearer test-api-token" },
      })
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Task not found");
  });

  it("deletes task_events rows when the parent task is deleted", async () => {
    const fixture = await bootApp();
    const taskId = "events-cascade";
    insertTask(fixture, taskId);
    insertEvent(fixture, { taskId, seq: 1, eventType: "tool_execution_start", payload: "{\"phase\":\"start\"}" });
    insertEvent(fixture, { taskId, seq: 2, eventType: "tool_execution_end", payload: "{\"phase\":\"end\"}" });

    fixture.db.delete(fixture.tasks).where(eq(fixture.tasks.id, taskId)).run();

    const remaining = fixture.db.select()
      .from(fixture.taskEvents)
      .where(eq(fixture.taskEvents.taskId, taskId))
      .all();
    expect(remaining).toHaveLength(0);
  });
});
