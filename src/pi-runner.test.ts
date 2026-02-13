import { describe, it, expect } from "vitest";
import {
  createFormatEventContext,
  createLineBuffer,
  formatEvent,
  runPiAgent,
  type PiCapturedEvent,
} from "./pi-runner.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockScript = join(__dirname, "test-fixtures", "mock-pi-rpc.mjs");

// ── createLineBuffer ────────────────────────────────────────────

describe("createLineBuffer", () => {
  it("emits complete lines split by newline", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("line1\nline2\n");
    expect(lines).toEqual(["line1", "line2"]);
  });

  it("buffers partial lines until completed", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("hel");
    expect(lines).toEqual([]);
    buf.push("lo\n");
    expect(lines).toEqual(["hello"]);
  });

  it("handles multiple lines in a single chunk", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("a\nb\nc\n");
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("flush emits remaining buffered content", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("partial");
    expect(lines).toEqual([]);
    buf.flush();
    expect(lines).toEqual(["partial"]);
  });

  it("ignores empty lines", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("\n\nfoo\n\n");
    expect(lines).toEqual(["foo"]);
  });
});

// ── formatEvent ─────────────────────────────────────────────────

describe("formatEvent", () => {
  it("text_delta returns the delta text", () => {
    const result = formatEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    });
    expect(result).toBe("hello");
  });

  it("tool_execution_start returns running message", () => {
    const result = formatEvent({
      type: "tool_execution_start",
      toolName: "Bash",
    });
    expect(result).toBe("\n>>> Running: Bash\n");
  });

  it("tool_execution_start includes command when provided", () => {
    const result = formatEvent({
      type: "tool_execution_start",
      toolName: "Bash",
      args: { command: "ls -la" },
    });
    expect(result).toBe("\n>>> Running: Bash — ls -la\n");
  });

  it("tool_execution_end (no error) returns done", () => {
    const result = formatEvent({ type: "tool_execution_end" });
    expect(result).toBe("\n<<< Done\n");
  });

  it("tool_execution_end (with error) returns error", () => {
    const result = formatEvent({
      type: "tool_execution_end",
      isError: true,
    });
    expect(result).toBe("\n<<< Error\n");
  });

  it("tool_execution_update extracts text from partialResult and de-duplicates cumulative text", () => {
    const ctx = createFormatEventContext();
    const first = formatEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      partialResult: {
        content: [{ type: "text", text: "first\n" }],
      },
    }, ctx);
    const second = formatEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      partialResult: {
        content: [{ type: "text", text: "first\nsecond\n" }],
      },
    }, ctx);

    expect(first).toBe("first\n");
    expect(second).toBe("second\n");
  });

  it("tool_execution_end extracts text from result and appends only remaining delta", () => {
    const ctx = createFormatEventContext();
    formatEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      partialResult: {
        content: [{ type: "text", text: "alpha\nbeta\n" }],
      },
    }, ctx);

    const end = formatEvent({
      type: "tool_execution_end",
      toolCallId: "t1",
      isError: false,
      result: {
        content: [{ type: "text", text: "alpha\nbeta\ngamma\n" }],
      },
    }, ctx);

    expect(end).toContain("gamma\n");
    expect(end).toContain("<<< Done");
    expect(end).not.toContain("alpha\nbeta\nalpha\nbeta\n");
  });

  it("tool_execution_update preserves legacy string fields", () => {
    const result = formatEvent({
      type: "tool_execution_update",
      text: "legacy output",
    });
    expect(result).toBe("legacy output");
  });

  it("error event returns error message", () => {
    const result = formatEvent({ type: "error", message: "boom" });
    expect(result).toBe("\n[ERROR] boom\n");
  });

  it("agent_end returns null (handled separately)", () => {
    expect(formatEvent({ type: "agent_end" })).toBeNull();
  });

  it("turn_start returns null", () => {
    expect(formatEvent({ type: "turn_start" })).toBeNull();
  });

  it("message_start returns null", () => {
    expect(formatEvent({ type: "message_start" })).toBeNull();
  });
});

// ── runPiAgent integration ──────────────────────────────────────

describe("runPiAgent integration", () => {
  it("runs mock pi and collects output", async () => {
    const chunks: string[] = [];
    const events: PiCapturedEvent[] = [];

    // Best approach: create a tiny shell script that ignores args and runs our mock
    const { writeFileSync, unlinkSync, chmodSync } = await import("fs");
    const wrapperPath = join(__dirname, "test-fixtures", "mock-pi-wrapper.sh");
    writeFileSync(
      wrapperPath,
      `#!/bin/sh\nexec node "${mockScript}" "$@"\n`,
    );
    chmodSync(wrapperPath, 0o755);

    // Temporarily override config
    const configModule = await import("./config.js");
    const origBinary = configModule.config.piBinary;
    // config is `as const` but we can still override via Object.defineProperty
    Object.defineProperty(configModule.config, "piBinary", {
      value: wrapperPath,
      writable: true,
      configurable: true,
    });

    try {
      const result = await runPiAgent({
        prompt: "test prompt",
        cwd: __dirname,
        timeoutMs: 10000,
        onOutput: (chunk) => chunks.push(chunk),
        onEvent: (event) => events.push(event),
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Hello");
      expect(result.output).toContain(" world");
      expect(result.output).toContain("!");
      expect(result.output).toContain(">>> Running: Bash");
      expect(result.output).toContain("first");
      expect(result.output).toContain("second");
      expect(result.output).toContain("third");
      expect(result.output).toContain("<<< Done");
      const lines = result.output.split(/\r?\n/);
      expect(lines.filter((line) => line === "first")).toHaveLength(1);
      expect(lines.filter((line) => line === "second")).toHaveLength(1);
      expect(lines.filter((line) => line === "third")).toHaveLength(1);
      expect(events.some((e) => e.stream === "rpc" && e.eventType === "tool_execution_update")).toBe(true);
      expect(events.some((e) => e.stream === "rpc" && e.textDelta === "second\n")).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(configModule.config, "piBinary", {
        value: origBinary,
        writable: true,
        configurable: true,
      });
      try {
        unlinkSync(wrapperPath);
      } catch {}
    }
  }, 15000);

  it("captures non-JSON stdout lines as output and structured events", async () => {
    const events: PiCapturedEvent[] = [];
    const { writeFileSync, unlinkSync, chmodSync } = await import("fs");
    const wrapperPath = join(
      __dirname,
      "test-fixtures",
      "mock-pi-rawline.sh",
    );
    writeFileSync(
      wrapperPath,
      `#!/bin/sh\nexport MOCK_MODE=rawline\nexec node "${mockScript}" "$@"\n`,
    );
    chmodSync(wrapperPath, 0o755);

    const configModule = await import("./config.js");
    const origBinary = configModule.config.piBinary;
    Object.defineProperty(configModule.config, "piBinary", {
      value: wrapperPath,
      writable: true,
      configurable: true,
    });

    try {
      const result = await runPiAgent({
        prompt: "test prompt",
        cwd: __dirname,
        timeoutMs: 10000,
        onEvent: (event) => events.push(event),
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("RAW STDOUT LINE");
      expect(events.some((e) => e.stream === "stdout_raw" && e.eventType === "stdout_raw")).toBe(true);
    } finally {
      Object.defineProperty(configModule.config, "piBinary", {
        value: origBinary,
        writable: true,
        configurable: true,
      });
      try {
        unlinkSync(wrapperPath);
      } catch {}
    }
  }, 15000);

  it("times out when agent_end never arrives", async () => {
    const { writeFileSync, unlinkSync, chmodSync } = await import("fs");
    const wrapperPath = join(
      __dirname,
      "test-fixtures",
      "mock-pi-timeout.sh",
    );
    writeFileSync(
      wrapperPath,
      `#!/bin/sh\nexport MOCK_MODE=timeout\nexec node "${mockScript}" "$@"\n`,
    );
    chmodSync(wrapperPath, 0o755);

    const configModule = await import("./config.js");
    const origBinary = configModule.config.piBinary;
    Object.defineProperty(configModule.config, "piBinary", {
      value: wrapperPath,
      writable: true,
      configurable: true,
    });

    try {
      const result = await runPiAgent({
        prompt: "test prompt",
        cwd: __dirname,
        timeoutMs: 1000,
      });

      expect(result.exitCode).toBe(124);
      expect(result.output).toContain("[TIMEOUT: Task exceeded time limit]");
    } finally {
      Object.defineProperty(configModule.config, "piBinary", {
        value: origBinary,
        writable: true,
        configurable: true,
      });
      try {
        unlinkSync(wrapperPath);
      } catch {}
    }
  }, 10000);

  it("handles error response from pi", async () => {
    const { writeFileSync, unlinkSync, chmodSync } = await import("fs");
    const wrapperPath = join(
      __dirname,
      "test-fixtures",
      "mock-pi-error.sh",
    );
    writeFileSync(
      wrapperPath,
      `#!/bin/sh\nexport MOCK_MODE=error\nexec node "${mockScript}" "$@"\n`,
    );
    chmodSync(wrapperPath, 0o755);

    const configModule = await import("./config.js");
    const origBinary = configModule.config.piBinary;
    Object.defineProperty(configModule.config, "piBinary", {
      value: wrapperPath,
      writable: true,
      configurable: true,
    });

    try {
      const result = await runPiAgent({
        prompt: "test prompt",
        cwd: __dirname,
        timeoutMs: 10000,
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("something went wrong");
    } finally {
      Object.defineProperty(configModule.config, "piBinary", {
        value: origBinary,
        writable: true,
        configurable: true,
      });
      try {
        unlinkSync(wrapperPath);
      } catch {}
    }
  }, 15000);
});
