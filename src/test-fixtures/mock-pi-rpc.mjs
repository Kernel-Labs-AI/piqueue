#!/usr/bin/env node
// Mock pi RPC process for integration tests.
// Reads a JSON prompt command from stdin, emits a sequence of RPC events, then waits.
// Modes controlled by env:
//   MOCK_MODE=timeout  → never send agent_end (for timeout tests)
//   MOCK_MODE=error    → send a response with success: false
//   MOCK_MODE=rawline  → emit a non-JSON stdout line during the run
//   (default)          → normal flow ending with agent_end

import { createInterface } from "readline";

const mode = process.env.MOCK_MODE || "normal";

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }

  if (cmd.type !== "prompt") return;

  // Always ack the command first (like real pi does)
  emit({ id: cmd.id, type: "response", command: "prompt", success: true });

  if (mode === "error") {
    emit({ type: "response", success: false, message: "something went wrong" });
    return;
  }

  // Normal flow — matches real pi RPC event structure
  emit({ type: "agent_start" });
  emit({ type: "turn_start" });
  emit({ type: "message_start", message: { role: "user" } });
  emit({ type: "message_end", message: { role: "user" } });
  emit({ type: "message_start", message: { role: "assistant" } });
  emit({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Hello" },
  });
  emit({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: " world" },
  });
  const bashArgs = { command: "echo first && echo second && echo third" };
  emit({
    type: "tool_execution_start",
    toolName: "Bash",
    toolCallId: "t1",
    args: bashArgs,
  });
  emit({
    type: "tool_execution_update",
    toolCallId: "t1",
    toolName: "Bash",
    args: bashArgs,
    partialResult: {
      content: [{ type: "text", text: "first\n" }],
      details: { truncation: null, fullOutputPath: null },
    },
  });
  emit({
    type: "tool_execution_update",
    toolCallId: "t1",
    toolName: "Bash",
    args: bashArgs,
    partialResult: {
      content: [{ type: "text", text: "first\nsecond\n" }],
      details: { truncation: null, fullOutputPath: null },
    },
  });
  emit({
    type: "tool_execution_end",
    toolCallId: "t1",
    toolName: "Bash",
    result: {
      content: [{ type: "text", text: "first\nsecond\nthird\n" }],
      details: { truncation: null, fullOutputPath: null },
    },
    isError: false,
  });
  emit({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "!" },
  });

  if (mode === "rawline") {
    process.stdout.write("RAW STDOUT LINE\n");
  }

  if (mode === "timeout") {
    // Never send agent_end — stay alive for timeout test
    return;
  }

  emit({ type: "agent_end" });
});

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}
