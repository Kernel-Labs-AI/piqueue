import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import type { Task } from "../db/schema.js";
import { dashboardView } from "./dashboard.js";

function createTask(override: Partial<Task>): Task {
  return {
    id: "task-id",
    title: "Task Title",
    prompt: "Prompt",
    status: "pending",
    priority: 0,
    source: "manual",
    externalId: null,
    awtTaskId: null,
    worktreePath: null,
    output: null,
    error: null,
    exitCode: null,
    pullRequestUrl: null,
    metadata: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:01.000Z",
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    gitBranch: null,
    ...override,
  };
}

describe("dashboardView", () => {
  it("renders empty states for all columns when no tasks exist", () => {
    const html = renderToString(dashboardView([], undefined, []));
    expect(html).toContain("No task currently running");
    expect(html).toContain("No tasks pending review");
    expect(html).toContain("No tasks yet");
  });

  it("renders running, pending, and recent cards", () => {
    const runningTask = createTask({ id: "running-1", status: "running", title: "Running Task" });
    const pendingTask = createTask({ id: "pending-1", title: "Pending Task" });
    const recentTask = createTask({
      id: "recent-1",
      title: "Recent Task",
      status: "completed",
      pullRequestUrl: "https://github.com/example/repo/pull/1",
    });

    const html = renderToString(
      dashboardView([pendingTask], runningTask, [pendingTask, recentTask])
    );

    expect(html).toContain("Running Task");
    expect(html).toContain("Pending Task");
    expect(html).toContain("Recent Task");
    expect(html).toContain('badge badge-running');
    expect(html).toContain("running");
    expect(html).toContain("Archive");
    expect(html).toContain("See PR");
  });
});
