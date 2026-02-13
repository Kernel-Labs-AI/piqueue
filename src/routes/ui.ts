import { Hono } from "hono";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { renderToString } from "hono/jsx/dom/server";
import { db } from "../db/index.js";
import { tasks, type Task } from "../db/schema.js";
import { layout } from "../views/layout.js";
import { dashboardView } from "../views/dashboard.js";
import { taskDetailView } from "../views/task-detail.js";
import { webhookView } from "../views/webhook.js";
import { getCompareUrl } from "../awt.js";
import { config } from "../config.js";
import { renderOutputContainer } from "../views/output.js";
import { taskSummaryView } from "../views/task-summary.js";
import { notFoundView } from "../views/not-found.js";

function fillCompareUrl(task: Task): Task {
  if (!task.pullRequestUrl && task.gitBranch) {
    return { ...task, pullRequestUrl: getCompareUrl(task.gitBranch) };
  }
  return task;
}

const ui = new Hono();

ui.get("/", async (c) => {
  const pendingTasks = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "pending"))
    .orderBy(desc(tasks.priority), asc(tasks.createdAt))
    .all();

  const runningTask = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "running"))
    .limit(1)
    .get();

  const recentTasks = db
    .select()
    .from(tasks)
    .where(isNull(tasks.archivedAt))
    .orderBy(desc(tasks.updatedAt))
    .limit(20)
    .all()
    .map(fillCompareUrl);

  return c.html(
    renderToString(layout("Pi-Queue Dashboard", dashboardView(pendingTasks, runningTask, recentTasks)))
  );
});

ui.get("/webhook", (c) => {
  return c.html(
    renderToString(
      layout("Webhook Instructions", webhookView({
        webhookSecret: config.webhookSecret,
        webhookUrl: new URL("/api/tasks", c.req.url).toString(),
      }))
    )
  );
});

ui.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!task) {
    return c.html(renderToString(layout("Not Found", notFoundView("Task not found"))), 404);
  }

  return c.html(renderToString(layout(`Task: ${task.title}`, taskDetailView(fillCompareUrl(task)))));
});

ui.get("/tasks/:id/output", async (c) => {
  const id = c.req.param("id");
  const task = db
    .select({ output: tasks.output, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, id))
    .get();

  if (!task) return c.text("", 404);

  const isRunning = task.status === "running";
  return c.html(renderToString(renderOutputContainer(task.output, isRunning, `/tasks/${id}/output`)));
});

ui.get("/tasks/:id/summary", async (c) => {
  const id = c.req.param("id");
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return c.text("", 404);

  return c.html(renderToString(taskSummaryView(fillCompareUrl(task))));
});

export { ui };
