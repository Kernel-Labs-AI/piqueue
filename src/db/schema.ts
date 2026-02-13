import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    priority: integer("priority").notNull().default(0),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),

    // Execution details
    awtTaskId: text("awt_task_id"),
    worktreePath: text("worktree_path"),
    gitBranch: text("git_branch"),
    output: text("output"),
    error: text("error"),
    exitCode: integer("exit_code"),
    pullRequestUrl: text("pull_request_url"),

    metadata: text("metadata"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_created").on(table.createdAt),
    index("idx_tasks_archived").on(table.archivedAt),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stream: text("stream", { enum: ["rpc", "stdout_raw", "stderr"] }).notNull(),
    eventType: text("event_type").notNull(),
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    payload: text("payload").notNull(),
    textDelta: text("text_delta"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("idx_task_events_task_seq").on(table.taskId, table.seq),
    index("idx_task_events_task_created").on(table.taskId, table.createdAt),
  ]
);

export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;
