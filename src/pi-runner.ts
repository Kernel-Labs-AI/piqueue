import { spawn } from "child_process";
import { config } from "./config.js";

export interface PiRunResult {
  output: string;
  exitCode: number;
}

export type PiCapturedEventStream = "rpc" | "stdout_raw" | "stderr";

export interface PiCapturedEvent {
  seq: number;
  stream: PiCapturedEventStream;
  eventType: string;
  toolCallId?: string;
  toolName?: string;
  payload: unknown;
  textDelta?: string;
}

export interface FormatEventContext {
  toolOutputByCallId: Map<string, string>;
}

export function createFormatEventContext(): FormatEventContext {
  return { toolOutputByCallId: new Map() };
}

// ── Pure helpers (exported for testing) ──────────────────────────

export function createLineBuffer(onLine: (line: string) => void) {
  let buf = "";
  return {
    push(chunk: string) {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop()!; // last element is the incomplete tail
      for (const line of lines) {
        if (line.length > 0) onLine(line);
      }
    },
    flush() {
      if (buf.length > 0) {
        onLine(buf);
        buf = "";
      }
    },
  };
}

function extractTextFromContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;

  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      chunks.push(rec.text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : null;
}

function extractToolText(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;

  const rec = result as Record<string, unknown>;
  const fromContent = extractTextFromContent(rec.content);
  if (fromContent !== null) return fromContent;
  if (typeof rec.text === "string") return rec.text;
  return null;
}

function resolveCumulativeDelta(
  toolCallId: string | undefined,
  text: string | null,
  context: FormatEventContext
): string | null {
  if (text === null || text.length === 0) return null;
  if (!toolCallId) return text;

  const prev = context.toolOutputByCallId.get(toolCallId) ?? "";
  let delta = text;

  if (text === prev || prev.startsWith(text)) {
    delta = "";
  } else if (text.startsWith(prev)) {
    delta = text.slice(prev.length);
  }

  context.toolOutputByCallId.set(toolCallId, text);
  return delta.length > 0 ? delta : null;
}

export function formatEvent(event: {
  type: string;
  [key: string]: unknown;
}, context: FormatEventContext = createFormatEventContext()): string | null {
  switch (event.type) {
    case "message_update": {
      const ame = event.assistantMessageEvent as
        | { type: string; delta?: string }
        | undefined;
      if (ame?.type === "text_delta" && ame.delta) {
        return ame.delta;
      }
      return null;
    }
    case "tool_execution_start": {
      const toolName = (event.toolName as string) ?? "tool";
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const args = event.args as Record<string, unknown> | undefined;
      let command: string | undefined;
      if (toolName.toLowerCase() === "bash" && args && typeof args === "object") {
        const candidate =
          (args.command as string | undefined) ??
          (args.cmd as string | undefined) ??
          (args.script as string | undefined);
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          command = candidate.trim();
        }
      }
      if (toolCallId) {
        context.toolOutputByCallId.set(toolCallId, "");
      }
      if (command) {
        return `\n>>> Running: ${toolName} — ${command}\n`;
      }
      return `\n>>> Running: ${toolName}\n`;
    }
    case "tool_execution_update": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const fromPartial = extractToolText(event.partialResult);
      const text =
        fromPartial ??
        (typeof event.text === "string" ? event.text : null) ??
        (typeof event.output === "string" ? event.output : undefined) ??
        extractToolText(event.result) ??
        (typeof event.stderr === "string" ? event.stderr : null);

      return resolveCumulativeDelta(toolCallId, text, context);
    }
    case "tool_execution_end": {
      const isError = event.isError as boolean | undefined;
      const tail = isError ? "\n<<< Error\n" : "\n<<< Done\n";
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const output =
        extractToolText(event.result) ??
        (typeof event.output === "string" ? event.output : null) ??
        (typeof event.stderr === "string" ? event.stderr : null);
      const text = resolveCumulativeDelta(toolCallId, output, context);
      if (toolCallId) {
        context.toolOutputByCallId.delete(toolCallId);
      }
      if (text) {
        return `\n${text}\n${tail}`;
      }
      return tail;
    }
    case "error": {
      const message =
        (event.message as string) ?? (event.error as string) ?? "unknown error";
      return `\n[ERROR] ${message}\n`;
    }
    default:
      return null;
  }
}

// ── Main runner ──────────────────────────────────────────────────

export async function runPiAgent(opts: {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  onEvent?: (event: PiCapturedEvent) => void;
}): Promise<PiRunResult> {
  const { prompt, cwd, timeoutMs = config.taskTimeoutMs, onOutput, onEvent } = opts;

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    let timedOut = false;
    let seq = 0;
    const formatContext = createFormatEventContext();

    const emitEvent = (event: Omit<PiCapturedEvent, "seq">) => {
      seq += 1;
      onEvent?.({ seq, ...event });
    };

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        const timeoutText = "\n\n[TIMEOUT: Task exceeded time limit]";
        output += timeoutText;
        onOutput?.(timeoutText);
        emitEvent({
          stream: "rpc",
          eventType: "timeout",
          payload: { type: "timeout", message: "Task exceeded time limit" },
          textDelta: timeoutText,
        });
      }
      try {
        proc.kill("SIGTERM");
      } catch {
        // already dead
      }
      resolve({ output, exitCode });
    };

    const append = (text: string) => {
      output += text;
      onOutput?.(text);
    };

    const proc = spawn(config.piBinary, ["--mode", "rpc", "--no-session"], {
      cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: config.anthropicApiKey,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      finish(124);
    }, timeoutMs);

    // ── Handle stdout: NDJSON event stream ──

    const lineBuf = createLineBuffer((line) => {
      let event: { type: string; [key: string]: unknown };
      try {
        event = JSON.parse(line);
      } catch {
        // non-JSON line — append as raw text
        const text = line + "\n";
        append(text);
        emitEvent({
          stream: "stdout_raw",
          eventType: "stdout_raw",
          payload: line,
          textDelta: text,
        });
        return;
      }

      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const toolName = typeof event.toolName === "string" ? event.toolName : undefined;

      // Completion detection
      if (event.type === "agent_end") {
        emitEvent({
          stream: "rpc",
          eventType: event.type,
          toolCallId,
          toolName,
          payload: event,
        });
        finish(0);
        return;
      }

      if (event.type === "response") {
        const success = event.success as boolean | undefined;
        if (success === false) {
          const msg =
            (event.message as string) ??
            (event.error as string) ??
            "unknown error";
          const text = `\n[ERROR] ${msg}\n`;
          append(text);
          emitEvent({
            stream: "rpc",
            eventType: event.type,
            toolCallId,
            toolName,
            payload: event,
            textDelta: text,
          });
          finish(1);
          return;
        }
        emitEvent({
          stream: "rpc",
          eventType: event.type,
          toolCallId,
          toolName,
          payload: event,
        });
        // success: true is just the command acknowledgment — ignore it
        return;
      }

      // Format and append
      const text = formatEvent(event, formatContext);
      if (text) append(text);
      emitEvent({
        stream: "rpc",
        eventType: event.type,
        toolCallId,
        toolName,
        payload: event,
        textDelta: text ?? undefined,
      });
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuf.push(chunk.toString());
    });

    // ── Stderr: capture in output stream and log ──

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      append(text);
      emitEvent({
        stream: "stderr",
        eventType: "stderr",
        payload: text,
        textDelta: text,
      });
      console.error(`[pi stderr] ${text.trimEnd()}`);
    });

    // ── Send RPC prompt command ──

    const cmd = JSON.stringify({
      type: "prompt",
      id: "req-1",
      message: prompt,
    });
    proc.stdin.write(cmd + "\n");
    // Keep stdin open — RPC mode expects it

    // ── Process exit before agent_end ──

    proc.on("close", (code) => {
      lineBuf.flush();
      if (!settled) {
        // Process exited before agent_end — always treat as failure
        finish(code || 1);
      }
    });

    proc.on("error", (err) => {
      if (!settled) {
        clearTimeout(timer);
        settled = true;
        reject(err);
      }
    });
  });
}
