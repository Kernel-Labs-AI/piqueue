import { Hono, type MiddlewareHandler } from "hono";
import { nanoid } from "nanoid";
import { asc, desc, eq } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db } from "../db/index.js";
import { taskEvents, tasks } from "../db/schema.js";
import { bearerAuth } from "../auth.js";
import { config } from "../config.js";

const api = new Hono();
const validStatuses = new Set([
  "pending",
  "approved",
  "rejected",
  "running",
  "completed",
  "failed",
]);

function secureEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function parseBasicCredentials(header: string): { username: string; password: string } | null {
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    return {
      username: decoded.slice(0, sep),
      password: decoded.slice(sep + 1),
    };
  } catch {
    return null;
  }
}

const requireApiAccess: MiddlewareHandler = async (c, next): Promise<Response | void> => {
  if (c.req.method === "POST" && c.req.path === "/api/tasks") {
    await next();
    return;
  }

  const authHeader = c.req.header("Authorization") || "";
  if (!authHeader) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token && secureEqual(token, config.apiAccessToken)) {
      await next();
      return;
    }
    return c.json({ error: "Invalid API token" }, 401);
  }

  const basic = parseBasicCredentials(authHeader);
  if (basic) {
    const usernameValid = secureEqual(basic.username, config.dashboardUser);
    const passwordValid = secureEqual(basic.password, config.dashboardPassword);
    if (usernameValid && passwordValid) {
      await next();
      return;
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
};

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): { value?: number; error?: string } {
  if (raw === undefined) return { value: fallback };
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { error: `must be an integer between ${min} and ${max}` };
  }
  return { value: parsed };
}

function parseOptionalString(
  value: unknown,
  field: string,
  maxLength: number
): { value: string | null; error?: string } {
  if (value === undefined || value === null) {
    return { value: null };
  }
  if (typeof value !== "string") {
    return { value: null, error: `${field} must be a string` };
  }
  if (value.length > maxLength) {
    return { value: null, error: `${field} must be at most ${maxLength} characters` };
  }
  return { value };
}

function parseRequiredString(
  value: unknown,
  field: string,
  maxLength: number
): { value?: string; error?: string } {
  if (typeof value !== "string") {
    return { error: `${field} is required` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${field} is required` };
  }
  if (trimmed.length > maxLength) {
    return { error: `${field} must be at most ${maxLength} characters` };
  }
  return { value: trimmed };
}

function parseOriginHeader(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const requireSameOrigin: MiddlewareHandler = async (c, next): Promise<Response | void> => {
  const expectedOrigin = config.publicOrigin || new URL(c.req.url).origin;
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");

  if (origin) {
    const parsedOrigin = parseOriginHeader(origin);
    if (!parsedOrigin) {
      return c.json({ error: "Invalid Origin header" }, 403);
    }
    if (parsedOrigin !== expectedOrigin) {
      return c.json({ error: "Cross-origin request blocked" }, 403);
    }
    await next();
    return;
  }

  if (referer) {
    const parsedRefererOrigin = parseOriginHeader(referer);
    if (!parsedRefererOrigin) {
      return c.json({ error: "Invalid Referer header" }, 403);
    }
    if (parsedRefererOrigin !== expectedOrigin) {
      return c.json({ error: "Cross-origin request blocked" }, 403);
    }
    await next();
    return;
  }

  return c.json({ error: "Missing Origin/Referer header" }, 403);
};

api.use("*", requireApiAccess);

// POST /api/tasks — webhook endpoint (bearer auth required)
api.post("/tasks", bearerAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Request body must be a JSON object" }, 400);
  }

  const title = parseRequiredString((body as Record<string, unknown>).title, "title", config.apiMaxTitleLength);
  if (title.error) return c.json({ error: title.error }, 400);

  const prompt = parseRequiredString((body as Record<string, unknown>).prompt, "prompt", config.apiMaxPromptLength);
  if (prompt.error) return c.json({ error: prompt.error }, 400);

  const source = parseOptionalString(
    (body as Record<string, unknown>).source,
    "source",
    config.apiMaxSourceLength
  );
  if (source.error) return c.json({ error: source.error }, 400);

  const externalId = parseOptionalString(
    (body as Record<string, unknown>).externalId,
    "externalId",
    config.apiMaxExternalIdLength
  );
  if (externalId.error) return c.json({ error: externalId.error }, 400);

  const rawPriority = (body as Record<string, unknown>).priority;
  let priority = config.defaultPriority;
  if (rawPriority !== undefined) {
    if (!Number.isInteger(rawPriority)) {
      return c.json({ error: "priority must be an integer" }, 400);
    }
    priority = rawPriority as number;
  }

  let metadata: string | null = null;
  if ((body as Record<string, unknown>).metadata !== undefined) {
    try {
      metadata = JSON.stringify((body as Record<string, unknown>).metadata);
    } catch {
      return c.json({ error: "metadata must be JSON-serializable" }, 400);
    }
    if (metadata && Buffer.byteLength(metadata, "utf8") > config.apiMaxMetadataBytes) {
      return c.json(
        { error: `metadata must be at most ${config.apiMaxMetadataBytes} bytes` },
        400
      );
    }
    if (metadata === "null") {
      metadata = null;
    }
  }

  const id = nanoid(12);
  const now = new Date().toISOString();

  db.insert(tasks)
    .values({
      id,
      title: title.value!,
      prompt: prompt.value!,
      priority,
      source: source.value ?? "manual",
      externalId: externalId.value,
      metadata,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return c.json({ id, status: "pending" }, 201);
});

// GET /api/tasks — list tasks with optional filters
api.get("/tasks", async (c) => {
  const status = c.req.query("status");
  if (status && !validStatuses.has(status)) {
    return c.json({ error: "Invalid status filter" }, 400);
  }

  const limitResult = parseBoundedInt(c.req.query("limit"), 20, 1, config.apiMaxPageSize);
  if (limitResult.error) {
    return c.json({ error: `limit ${limitResult.error}` }, 400);
  }

  const offsetResult = parseBoundedInt(c.req.query("offset"), 0, 0, config.apiMaxOffset);
  if (offsetResult.error) {
    return c.json({ error: `offset ${offsetResult.error}` }, 400);
  }

  const whereClause = status ? eq(tasks.status, status as any) : undefined;

  const results = db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      source: tasks.source,
      externalId: tasks.externalId,
      awtTaskId: tasks.awtTaskId,
      pullRequestUrl: tasks.pullRequestUrl,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(whereClause)
    .orderBy(desc(tasks.priority), desc(tasks.createdAt))
    .limit(limitResult.value!)
    .offset(offsetResult.value!)
    .all();
  return c.json(results);
});

// GET /api/tasks/:id — get full task details
api.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json(task);
});

// GET /api/tasks/:id/events — get task event stream
api.get("/tasks/:id/events", async (c) => {
  const id = c.req.param("id");
  const task = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).get();
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const limitResult = parseBoundedInt(
    c.req.query("limit"),
    Math.min(200, config.apiMaxPageSize),
    1,
    config.apiMaxPageSize
  );
  if (limitResult.error) {
    return c.json({ error: `limit ${limitResult.error}` }, 400);
  }

  const offsetResult = parseBoundedInt(c.req.query("offset"), 0, 0, config.apiMaxOffset);
  if (offsetResult.error) {
    return c.json({ error: `offset ${offsetResult.error}` }, 400);
  }

  const events = db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, id))
    .orderBy(asc(taskEvents.seq))
    .limit(limitResult.value!)
    .offset(offsetResult.value!)
    .all()
    .map((event) => {
      let parsedPayload: unknown = event.payload;
      try {
        parsedPayload = JSON.parse(event.payload);
      } catch {
        // Preserve raw payload when parsing fails
      }
      return {
        ...event,
        payload: parsedPayload,
      };
    });

  return c.json(events);
});

// POST /api/tasks/:id/approve — move pending → approved
api.post("/tasks/:id/approve", requireSameOrigin, async (c) => {
  const id = c.req.param("id");
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (task.status !== "pending") {
    return c.json({ error: `Cannot approve task with status '${task.status}'` }, 400);
  }

  const now = new Date().toISOString();
  db.update(tasks)
    .set({ status: "approved", updatedAt: now })
    .where(eq(tasks.id, id))
    .run();

  return c.json({ id, status: "approved" });
});

// POST /api/tasks/:id/reject — move pending → rejected
api.post("/tasks/:id/reject", requireSameOrigin, async (c) => {
  const id = c.req.param("id");
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (task.status !== "pending") {
    return c.json({ error: `Cannot reject task with status '${task.status}'` }, 400);
  }

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  let reason: string | null = null;
  const reasonInput = (body as Record<string, unknown>).reason;
  if (reasonInput !== undefined && reasonInput !== null) {
    if (typeof reasonInput !== "string") {
      return c.json({ error: "reason must be a string" }, 400);
    }
    if (reasonInput.length > config.apiMaxRejectReasonLength) {
      return c.json(
        { error: `reason must be at most ${config.apiMaxRejectReasonLength} characters` },
        400
      );
    }
    reason = reasonInput;
  }

  const now = new Date().toISOString();
  db.update(tasks)
    .set({
      status: "rejected",
      error: reason,
      updatedAt: now,
    })
    .where(eq(tasks.id, id))
    .run();

  return c.json({ id, status: "rejected" });
});

// POST /api/tasks/:id/archive — archive a task (hide from recent list)
api.post("/tasks/:id/archive", requireSameOrigin, async (c) => {
  const id = c.req.param("id");
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (task.status === "running" || task.status === "pending") {
    return c.json({ error: `Cannot archive task with status '${task.status}'` }, 400);
  }

  const now = new Date().toISOString();
  db.update(tasks)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(tasks.id, id))
    .run();

  return c.json({ id, archived: true });
});

// DELETE /api/tasks/:id — delete non-running tasks
api.delete("/tasks/:id", requireSameOrigin, async (c) => {
  const id = c.req.param("id");
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (task.status === "running") {
    return c.json({ error: "Cannot delete a running task" }, 400);
  }

  db.delete(tasks).where(eq(tasks.id, id)).run();
  return c.json({ deleted: true });
});

export { api };
