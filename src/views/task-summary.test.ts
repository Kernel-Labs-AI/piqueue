import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import type { Task } from "../db/schema.js";
import { taskSummaryView } from "./task-summary.js";

function createTask(override: Partial<Task>): Task {
  return {
    id: "task-summary-id",
    title: "Summary Task",
    prompt: "Do work",
    status: "running",
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
    createdAt: "2025-01-01T12:00:00.000Z",
    updatedAt: "2025-01-01T12:00:01.000Z",
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    gitBranch: null,
    ...override,
  };
}

describe("taskSummaryView", () => {
  it("contains required OOB ids and output stream", () => {
    const html = renderToString(taskSummaryView(createTask({ status: "running", output: "Status update" })));

    expect(html).toContain('id="task-status-badge"');
    expect(html).toContain('id="panel-status"');
    expect(html).toContain('id="task-inline-meta"');
    expect(html).toContain('id="task-meta-grid"');
    expect(html).toContain('id="task-output-container"');
    expect(html).toContain('hx-swap-oob="true"');
    expect(html).toContain('id="task-output"');
  });
});
