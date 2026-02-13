import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { taskEvents, tasks } from "./db/schema.js";
import { awtStartTask, awtCommitTask, pushBranch, getCompareUrl } from "./awt.js";
import { runPiAgent, type PiCapturedEvent } from "./pi-runner.js";

const POLL_INTERVAL_MS = 2000;

let running = false;
let shuttingDown = false;

function serializePayload(payload: unknown): string {
  try {
    const json = JSON.stringify(payload);
    if (typeof json === "string") return json;
    return JSON.stringify({ value: payload === undefined ? null : String(payload) });
  } catch {
    return JSON.stringify({ value: String(payload) });
  }
}

export function startWorker(): void {
  running = true;
  console.log("[worker] Started — polling for approved tasks");
  poll();
}

export function stopWorker(): Promise<void> {
  shuttingDown = true;
  console.log("[worker] Shutdown requested, finishing current task...");
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (!running) {
        clearInterval(check);
        resolve();
      }
    }, 500);
  });
}

async function poll(): Promise<void> {
  while (!shuttingDown) {
    try {
      const nextTask = db
        .select()
        .from(tasks)
        .where(eq(tasks.status, "approved"))
        .orderBy(desc(tasks.priority), asc(tasks.createdAt))
        .limit(1)
        .get();

      if (nextTask) {
        await processTask(nextTask.id);
      }
    } catch (err) {
      console.error("[worker] Poll error:", err);
    }

    if (!shuttingDown) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  running = false;
  console.log("[worker] Stopped");
}

async function processTask(taskId: string): Promise<void> {
  const now = () => new Date().toISOString();
  const claimResult = db.update(tasks)
    .set({
      status: "running",
      startedAt: now(),
      updatedAt: now(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, "approved")))
    .run();

  if (claimResult.changes !== 1) {
    return;
  }

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return;
  let liveOutput = task.output || "";

  console.log(`[worker] Processing task ${task.id}: ${task.title}`);

  try {
    // 1. Create worktree via awt
    const awt = await awtStartTask(task.title);

    // 2. Attach awt metadata to the already-running task
    db.update(tasks)
      .set({
        awtTaskId: awt.taskId,
        worktreePath: awt.worktreePath,
        gitBranch: awt.branch,
        updatedAt: now(),
      })
      .where(eq(tasks.id, taskId))
      .run();

    // 3. Run Pi agent
    const result = await runPiAgent({
      prompt: task.prompt,
      cwd: awt.worktreePath,
      onOutput: (chunk) => {
        if (chunk.length === 0) return;
        liveOutput += chunk;
        db.update(tasks)
          .set({ output: liveOutput, updatedAt: now() })
          .where(eq(tasks.id, taskId))
          .run();
      },
      onEvent: (event: PiCapturedEvent) => {
        db.insert(taskEvents)
          .values({
            taskId,
            seq: event.seq,
            stream: event.stream,
            eventType: event.eventType,
            toolCallId: event.toolCallId ?? null,
            toolName: event.toolName ?? null,
            payload: serializePayload(event.payload),
            textDelta: event.textDelta ?? null,
            createdAt: now(),
          })
          .run();
      },
    });

    console.log(`[worker] Task ${taskId} finished — exit code: ${result.exitCode}, output length: ${result.output.length}`);

    if (result.exitCode === 0) {
      // 4. Handoff — push branch + create PR
      let pullRequestUrl: string | null = null;
      try {
        await awtCommitTask(awt.taskId, task.title);
        await pushBranch(awt.worktreePath, awt.branch);
        pullRequestUrl = getCompareUrl(awt.branch);
      } catch (handoffErr) {
        console.error(`[worker] push failed for ${taskId}:`, handoffErr);
        // Still mark as completed — the work was done, just push failed
        pullRequestUrl = getCompareUrl(awt.branch);
      }

      db.update(tasks)
        .set({
          status: "completed",
          output: result.output,
          exitCode: result.exitCode,
          pullRequestUrl,
          completedAt: now(),
          updatedAt: now(),
        })
        .where(eq(tasks.id, taskId))
        .run();

      console.log(`[worker] Task ${taskId} completed`);
    } else {
      db.update(tasks)
        .set({
          status: "failed",
          output: result.output,
          exitCode: result.exitCode,
          error: `Process exited with code ${result.exitCode}`,
          completedAt: now(),
          updatedAt: now(),
        })
        .where(eq(tasks.id, taskId))
        .run();

      console.log(`[worker] Task ${taskId} failed (exit code ${result.exitCode})`);
    }
  } catch (err: any) {
    db.update(tasks)
      .set({
        status: "failed",
        error: err.message || String(err),
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(tasks.id, taskId))
      .run();

    console.error(`[worker] Task ${taskId} error:`, err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
