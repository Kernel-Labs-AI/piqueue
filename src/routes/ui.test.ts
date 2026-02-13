import { randomUUID } from "crypto";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

type AppFixture = {
  app: {
    request: (input: Request | string, init?: RequestInit) => Promise<Response> | Response;
  };
  db: any;
  tasks: unknown;
  cleanupDatabasePath: string;
};

const databasePaths: string[] = [];
const uiAuthHeader = `Basic ${Buffer.from("test-dashboard:test-password").toString("base64")}`;

function cleanupDbFiles(databasePath: string): void {
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
}

async function bootApp(): Promise<AppFixture> {
  vi.resetModules();

  const databasePath = join(tmpdir(), `pi-queue-ui-${randomUUID()}.db`);
  databasePaths.push(databasePath);

  process.env.NODE_ENV = "test";
  process.env.WEBHOOK_SECRET = "test-secret";
  process.env.DASHBOARD_USER = "test-dashboard";
  process.env.DASHBOARD_PASSWORD = "test-password";
  process.env.DATABASE_PATH = databasePath;

  const [serverModule, dbModule, schemaModule] = await Promise.all([
    import("../server.js"),
    import("../db/index.js"),
    import("../db/schema.js"),
  ]);

  return {
    app: serverModule.app,
    db: dbModule.db,
    tasks: schemaModule.tasks,
    cleanupDatabasePath: databasePath,
  };
}

function insertTask(
  fixture: AppFixture,
  id: string,
  overrides: Record<string, unknown> = {}
) {
  const now = new Date().toISOString();
  const baseTask = {
    id,
    title: `Task ${id}`,
    prompt: "Do work",
    status: "pending" as const,
    priority: 0,
    source: "manual",
    createdAt: now,
    updatedAt: now,
    output: null,
    pullRequestUrl: null,
    externalId: `external-${id}`,
    startedAt: null,
    completedAt: null,
    exitCode: null,
    gitBranch: null,
    metadata: null,
    error: null,
    awtTaskId: null,
    worktreePath: null,
    archivedAt: null,
  };

  fixture.db.insert(fixture.tasks).values({
    ...baseTask,
    ...overrides,
    output: overrides.output ?? null,
  }).run();
}

afterEach(() => {
  while (databasePaths.length > 0) {
    const databasePath = databasePaths.pop();
    if (databasePath) cleanupDbFiles(databasePath);
  }
  delete process.env.DATABASE_PATH;
  delete process.env.PUBLIC_ORIGIN;
  delete process.env.FLY_APP_NAME;
  delete process.env.DASHBOARD_USER;
  delete process.env.DASHBOARD_PASSWORD;
});

describe("UI routes", () => {
  it("Webhook route includes external webhook script and avoids inline script bodies", async () => {
    const { app } = await bootApp();
    const response = await app.request(
      new Request("https://webhook-view.example/webhook", {
        headers: { Authorization: uiAuthHeader },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toMatch(
      /<script[^>]*defer(?:="")?[^>]*src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/highlight\.js\/11\.9\.0\/highlight\.min\.js"[^>]*><\/script>/
    );
    expect(body).toMatch(
      /<script[^>]*defer(?:="")?[^>]*src="\/assets\/js\/syntax-highlight\.js"[^>]*><\/script>/
    );
    expect(body).toContain('<script type="module" src="/assets/js/webhook.js"></script>');
    expect(body).toContain('<script type="module" src="/assets/js/dashboard.js"></script>');
    expect(body).toContain('data-url="https://webhook-view.example/api/tasks"');
    expect(body).not.toMatch(new RegExp("<script(?![^>]*\\bsrc=)[^>]*>[\\s\\S]*?</script>"));
  });

  it("Task detail route renders component structure without inline script fragments", async () => {
    const fixture = await bootApp();
    insertTask(fixture, "detail-1", {
      status: "running",
      output: "Starting task\n>>> Running: bash — echo hi\n```\nhello world",
    });

    const response = await fixture.app.request(
      new Request("https://ui-view.example/tasks/detail-1", {
        headers: { Authorization: uiAuthHeader },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('id="task-output-container"');
    expect(body).toContain('id="task-output"');
    expect(body).toContain('id="task-inline-meta"');
    expect(body).toContain('hx-get="/tasks/detail-1/summary"');
    expect(body).not.toMatch(new RegExp("<script(?![^>]*\\bsrc=)[^>]*>[\\s\\S]*?</script>"));
  });

  it("Task detail route does not start polling when task is completed", async () => {
    const fixture = await bootApp();
    insertTask(fixture, "detail-done-1", {
      status: "completed",
      output: "Task complete",
    });

    const response = await fixture.app.request(
      new Request("https://ui-view.example/tasks/detail-done-1", {
        headers: { Authorization: uiAuthHeader },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('id="task-output-container"');
    expect(body).toContain('id="task-poller"');
    expect(body).toContain('hx-swap-oob="true"');
    expect(body).not.toContain('hx-get="/tasks/detail-done-1/summary"');
    expect(body).not.toContain('hx-trigger="every 1s"');
    expect(body).not.toContain('<div id="task-poller" hx-swap-oob="true" hx-swap="none"');
  });

  it("Task summary route renders OOB snippets and does not include inline script fragments", async () => {
    const fixture = await bootApp();
    insertTask(fixture, "summary-1", {
      status: "running",
      output: "Thinking about work",
    });

    const response = await fixture.app.request(
      new Request("https://ui-view.example/tasks/summary-1/summary", {
        headers: { Authorization: uiAuthHeader },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('id="task-status-badge" hx-swap-oob="true"');
    expect(body).toContain('id="panel-status" hx-swap-oob="true"');
    expect(body).toContain('id="task-inline-meta" hx-swap-oob="true"');
    expect(body).toContain('id="task-meta-grid" hx-swap-oob="true"');
    expect(body).toContain('id="task-output-container" hx-swap-oob="true"');
    expect(body).toContain('id="task-output"');
    expect(body).toContain('hx-swap-oob="true"');
    expect(body).not.toContain('hx-get="/tasks/summary-1/output"');

    const pollerStart = body.indexOf('id="task-poller"');
    expect(pollerStart).toBeGreaterThanOrEqual(0);
    expect(body).toContain('hx-get="/tasks/summary-1/summary"');
    expect(body).toContain('hx-trigger="every 1s"');
    expect(body).toContain('hx-swap="none"');
    expect(body).not.toMatch(new RegExp("<script(?![^>]*\\bsrc=)[^>]*>[\\s\\S]*?</script>"));
  });

  it("Task summary stops poller once task is completed", async () => {
    const fixture = await bootApp();
    insertTask(fixture, "summary-done", {
      status: "completed",
      output: "Task complete",
    });

    const response = await fixture.app.request(
      new Request("https://ui-view.example/tasks/summary-done/summary", {
        headers: { Authorization: uiAuthHeader },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('id="task-poller"');
    expect(body).toContain('hx-swap-oob="true"');
    expect(body).not.toContain('hx-get="/tasks/summary-done/summary"');
    expect(body).not.toContain('hx-trigger="every 1s"');
    expect(body).not.toContain('hx-swap="none"');
  });
});
