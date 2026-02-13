import { marked } from "marked";
import type { Child } from "hono/jsx";

type OutputEvent = OutputToolEvent | OutputThinkingEvent | OutputErrorEvent;

type OutputToolEvent = {
  type: "tool";
  toolName: string;
  command?: string;
  status: "running" | "done" | "error";
  lines: string[];
};

type OutputThinkingEvent = {
  type: "thinking";
  lines: string[];
};

type OutputErrorEvent = {
  type: "error";
  message: string;
};

type MarkdownToken = {
  type: string;
  text?: string;
  raw?: string;
  lang?: string;
  href?: string;
  depth?: number;
  ordered?: boolean;
  tokens?: unknown;
  items?: unknown;
  [key: string]: unknown;
};

const TOOL_STATUS_META: Record<
  OutputToolEvent["status"],
  { label: string; statusClass: string }
> = {
  done: { label: "done", statusClass: "success" },
  error: { label: "error", statusClass: "error" },
  running: { label: "running", statusClass: "running" },
};

export function renderOutputContainer(
  output: string | null,
  isRunning: boolean,
  pollUrl: string,
  shouldPoll = true
) {
  const content = renderOutputTimeline(output, isRunning);

  if (!isRunning) {
    return (
      <div id="task-output" class="output-stream" data-follow-output="true">
        {content}
      </div>
    );
  }

  if (!shouldPoll) {
    return (
      <div id="task-output" class="output-stream" data-follow-output="true" aria-live="polite">
        {content}
      </div>
    );
  }

  return (
    <div
      id="task-output"
      class="output-stream"
      data-follow-output="true"
      hx-get={pollUrl}
      hx-trigger="every 1.5s"
      hx-swap="outerHTML"
      aria-live="polite"
    >
      {content}
    </div>
  );
}

function isReadTool(toolName: string) {
  return toolName.trim().toLowerCase() === "read";
}

function getReadLanguage(command?: string) {
  if (!command) return undefined;

  const clean = command.replace(/^(["'`])|(["'`])$/g, "");
  const tokens = clean.split(/\s+/).filter((token) => token.length > 0);

  for (let i = tokens.length - 1; i >= 0; i--) {
    const fileName = stripWrappingQuotes(tokens[i]);
    if (fileName.startsWith("-")) continue;
    const extension = getFileExtension(fileName);
    if (extension) return mapExtensionToLanguage(extension);
  }

  return undefined;
}

function mapExtensionToLanguage(extension: string) {
  const normalized = extension.toLowerCase();
  const map: Record<string, string> = {
    "js": "javascript",
    "jsx": "javascript",
    "cjs": "javascript",
    "mjs": "javascript",
    "mts": "typescript",
    "cts": "typescript",
    "ts": "typescript",
    "tsx": "tsx",
    "html": "xml",
    "htm": "xml",
    "css": "css",
    "scss": "scss",
    "sass": "sass",
    "json": "json",
    "jsonc": "json",
    "yaml": "yaml",
    "yml": "yaml",
    "toml": "ini",
    "md": "markdown",
    "markdown": "markdown",
    "txt": "text",
    "py": "python",
    "rb": "ruby",
    "go": "go",
    "java": "java",
    "c": "c",
    "cpp": "cpp",
    "cc": "cpp",
    "cxx": "cpp",
    "h": "cpp",
    "hpp": "cpp",
    "rs": "rust",
    "php": "php",
    "sh": "bash",
    "bash": "bash",
    "zsh": "bash",
    "sql": "sql",
    "xml": "xml",
    "dockerfile": "dockerfile",
    "tf": "hcl",
  };

  return map[normalized] || normalized;
}

function getCodeLanguageClass(language?: string) {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return undefined;
  return `language-${normalized}`;
}

function getToolLanguage(toolName: string, command?: string) {
  if (isReadTool(toolName)) {
    return getReadLanguage(command);
  }

  const normalizedToolName = toolName.trim().toLowerCase();
  if (normalizedToolName === "bash" || normalizedToolName === "sh" || normalizedToolName === "shell") {
    return "bash";
  }

  return getReadLanguage(command);
}

function getToolLanguageAttribute(toolName: string, command?: string) {
  return getToolLanguage(toolName, command) || undefined;
}

function getFileExtension(fileName: string) {
  if (!fileName || typeof fileName !== "string") return null;
  const safeName = fileName.trim();

  if (!safeName) return null;
  const normalizedCandidate = normalizeFileNameForExtension(safeName);
  const normalized = normalizedCandidate.split(/[\\/]/).pop() || normalizedCandidate;
  const lastDot = normalized.lastIndexOf(".");

  if (lastDot <= 0 || lastDot >= normalized.length - 1) {
    if (normalized.toLowerCase() === "dockerfile") return "dockerfile";
    return null;
  }
  return normalized.slice(lastDot + 1);
}

function stripWrappingQuotes(value: string) {
  return value.replace(/^(["'`])|(["'`])$/g, "");
}

function normalizeFileNameForExtension(value: string) {
  const trimmed = value.trim().replace(/[),;\]]+$/g, "");
  const withoutQueryOrHash = (trimmed.split(/[?#]/, 1)[0] || trimmed).trim();
  return withoutQueryOrHash.replace(/:(\d+)(?::\d+)?(?:-\d+(?::\d+)?)?$/, "");
}

export function renderOutputTimeline(output: string | null, isRunning: boolean) {
  const events = parseOutputEvents(output || "");

  if (events.length === 0) {
    return (
      <div class="output-item output-item-placeholder">
        <div class="output-item-body">{isRunning ? "Waiting for output..." : "No output yet..."}</div>
      </div>
    );
  }

  return (
    <>
      {events.map((event, index) => renderEvent(event, index))}
    </>
  );
}

function parseOutputEvents(output: string): OutputEvent[] {
  const lines = output.split(/\r?\n/);
  const events: OutputEvent[] = [];
  let currentToolIndex: number | null = null;
  let messageBuf: string[] = [];

  const flushMessage = () => {
    if (messageBuf.length === 0) return;
    events.push({ type: "thinking", lines: messageBuf });
    messageBuf = [];
  };

  const startTool = (toolName: string, command?: string) => {
    flushMessage();
    const toolEvent: OutputToolEvent = {
      type: "tool",
      toolName,
      command,
      status: "running",
      lines: [],
    };
    events.push(toolEvent);
    currentToolIndex = events.length - 1;
  };

  const endTool = (status: "done" | "error") => {
    if (currentToolIndex === null) {
      flushMessage();
      events.push({
        type: "tool",
        toolName: "Tool",
        status,
        lines: [],
      });
      return;
    }

    const currentTool = events[currentToolIndex];
    if (currentTool.type === "tool") {
      currentTool.status = status;
    }
    currentToolIndex = null;
  };

  const getCurrentTool = () => {
    if (currentToolIndex === null) return null;
    const currentTool = events[currentToolIndex];
    return currentTool?.type === "tool" ? currentTool : null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") continue;

    const toolStart = line.match(/^>>>\s*Running:\s*(.+?)(?:\s+—\s+(.*))?$/);
    if (toolStart) {
      const toolName = toolStart[1].trim();
      const command = toolStart[2]?.trim();
      startTool(toolName, command || undefined);
      continue;
    }

    if (line === "<<< Done") {
      flushMessage();
      endTool("done");
      continue;
    }

    if (line === "<<< Error") {
      flushMessage();
      endTool("error");
      continue;
    }

    const errorLine = line.match(/^\[ERROR\]\s*(.+)$/);
    if (errorLine) {
      flushMessage();
      events.push({ type: "error", message: errorLine[1] });
      continue;
    }

    const currentTool = getCurrentTool();
    if (currentTool !== null) {
      currentTool.lines.push(line);
      continue;
    }

    messageBuf.push(line);
  }

  flushMessage();
  return events;
}

function renderEvent(event: OutputEvent, index: number) {
  switch (event.type) {
    case "tool": {
      const statusMeta = TOOL_STATUS_META[event.status];
      const toolLanguage = getToolLanguage(event.toolName, event.command);

      return (
        <details
          class="output-item output-item-tool"
          data-tool-id={`tool-${index}`}
          data-tool-name={event.toolName}
          data-tool-command={event.command}
          data-tool-lang={getToolLanguageAttribute(event.toolName, event.command)}
        >
          <summary class="output-item-header">
            <span class="output-kind">Tool</span>
            <span class="output-title">{event.toolName}</span>
            <span class={`output-status output-status-${statusMeta.statusClass}`}>{statusMeta.label}</span>
            {event.command ? <span class="output-command">{event.command}</span> : null}
          </summary>
          {event.lines.length > 0 ? (
            <div class="output-item-body output-item-body-md">
              <pre class="md-code">
                <code data-lang={toolLanguage} class={getCodeLanguageClass(toolLanguage)}>{event.lines.join("\n")}</code>
              </pre>
            </div>
          ) : null}
        </details>
      );
    }
    case "error":
      return (
        <div class="output-item output-item-error">
          <div class="output-item-header">
            <span class="output-kind output-kind-error">Error</span>
          </div>
          <div class="output-item-body">{event.message}</div>
        </div>
      );
    case "thinking":
      return (
        <div class="output-item output-item-thinking">
          <div class="output-item-body output-item-body-md">{renderMarkdown(event.lines.join("\n"))}</div>
        </div>
      );
  }
}

function renderMarkdown(text: string) {
  const normalizedText = normalizeUnterminatedCodeFence(text);
  const tokens = marked.lexer(normalizedText) as MarkdownToken[];

  return <>{tokens.map(renderMarkdownBlock)}</>;
}

function renderMarkdownBlock(token: MarkdownToken, index: number): Child {
  const children = tokenChildren(token);

  switch (token.type) {
    case "heading": {
      const level = tokenField<number>(token, "depth", 1);
      const headingChildren = tokenChildrenExists(token)
        ? renderMarkdownInlines(children)
        : splitTextByLine(tokenField<string>(token, "text", ""));
      return renderHeading(level, headingChildren);
    }
    case "paragraph":
      return children.length > 0 ? <p>{renderMarkdownInlines(children)}</p> : <p>{tokenField(token, "text", "")}</p>;
    case "list":
      return renderMarkdownList(tokenField(token, "ordered", false), listItems(token), tokenChildren(token));
    case "code":
      {
        const language = tokenField<string>(token, "lang", "");
        const languageClass = getCodeLanguageClass(language);

      return (
        <pre class="md-code">
          <code data-lang={language} class={languageClass}>{tokenField<string>(token, "text", "")}</code>
        </pre>
      );
      }
    case "blockquote":
      return <blockquote class="md-quote">{children.length ? children.map(renderMarkdownBlock) : null}</blockquote>;
    case "html":
      return splitTextByLine(tokenField(token, "raw", tokenField<string>(token, "text", "")));
    case "text":
      return renderInlineText(tokenField<string>(token, "text", ""));
    case "space":
      return null;
    case "list_item":
      return renderMarkdownListItem(token);
    case "strong":
      return <strong>{renderMarkdownInlines(children)}</strong>;
    case "em":
      return <em>{renderMarkdownInlines(children)}</em>;
    case "codespan":
      return <code class="md-inline">{tokenField<string>(token, "text", "")}</code>;
    case "link":
      return renderInlineLink(token);
    case "del":
      return <del>{renderMarkdownInlines(children)}</del>;
    case "br":
      return <br />;
    default:
      if (children.length > 0) {
        if (isMarkdownBlockToken(token.type)) {
          return <>{children.map((child, childIndex) => renderMarkdownBlock(child, childIndex))}</>;
        }

        return renderMarkdownInlines(children);
      }

      return splitTextByLine(tokenField<string>(token, "text", ""));
  }
}

function renderMarkdownList(
  ordered: boolean,
  listItemsTokens: MarkdownToken[],
  fallbackItems: MarkdownToken[]
) {
  const parsedItems = getListItems(listItemsTokens, fallbackItems);
  const ListTag = ordered ? "ol" : "ul";
  const classes = "md-list";

  return (
    <ListTag class={classes}>
      {parsedItems.map((item, index) => (
        <li key={`md-item-${index}`}>{renderMarkdownListItem(item)}</li>
      ))}
    </ListTag>
  );
}

function renderMarkdownListItem(item: MarkdownToken): Child {
  const itemChildren = tokenChildren(item);
  if (itemChildren.length === 0) {
    return splitTextByLine(tokenField<string>(item, "text", ""));
  }

  return itemChildren.map((child, childIndex) => renderMarkdownBlock(child, childIndex));
}

function renderMarkdownInlines(tokens: MarkdownToken[] | string): Child[] {
  if (!Array.isArray(tokens)) {
    if (typeof tokens === "string") {
      return splitTextByLine(tokens);
    }
    return [];
  }

  return tokens.flatMap((token, index) => {
    if (!isMarkdownToken(token)) {
      return [];
    }

    if (token.type === "text") {
      return renderInlineText(tokenField<string>(token, "text", ""));
    }
    if (token.type === "strong") {
      return [<strong key={`md-strong-${index}`}>{renderMarkdownInlines(tokenChildren(token))}</strong>];
    }
    if (token.type === "em") {
      return [<em key={`md-em-${index}`}>{renderMarkdownInlines(tokenChildren(token))}</em>];
    }
    if (token.type === "codespan") {
      return [<code class="md-inline" key={`md-code-${index}`}>{tokenField<string>(token, "text", "")}</code>];
    }
    if (token.type === "link") {
      return [renderInlineLink(token)];
    }
    if (token.type === "del") {
      return [<del key={`md-del-${index}`}>{renderMarkdownInlines(tokenChildren(token))}</del>];
    }
    if (token.type === "br") {
      return [<br key={`md-br-${index}`} />];
    }
    if (isMarkdownBlockToken(token.type)) {
      return [tokenField<string>(token, "text", "")];
    }
    if (token.type === "html") {
      return splitTextByLine(tokenField(token, "raw", tokenField<string>(token, "text", "")));
    }
    if (token.type === "image") {
      return [];
    }

    return splitTextByLine(tokenField<string>(token, "text", ""));
  });
}

function renderInlineLink(token: MarkdownToken): Child {
  const href = sanitizeMarkdownHref(tokenField<string>(token, "href", ""));
  if (!href) {
    return splitTextByLine(tokenField<string>(token, "text", ""));
  }

  const children = tokenChildren(token);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children.length > 0 ? renderMarkdownInlines(children) : tokenField<string>(token, "text", "")}
    </a>
  );
}

function renderHeading(level: number, children: Child[]): Child {
  const safeLevel = Math.max(1, Math.min(6, level || 1));
  const headingChildren = children;

  if (safeLevel === 1) return <h1>{headingChildren}</h1>;
  if (safeLevel === 2) return <h2>{headingChildren}</h2>;
  if (safeLevel === 3) return <h3>{headingChildren}</h3>;
  if (safeLevel === 4) return <h4>{headingChildren}</h4>;
  if (safeLevel === 5) return <h5>{headingChildren}</h5>;
  return <h6>{headingChildren}</h6>;
}

function splitTextByLine(text: string) {
  const parts = text.split(/\r?\n/);
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) {
      return [part];
    }
    return [part, <br key={`md-br-${index}`} />];
  });
}

function renderInlineText(text: string): Child[] {
  const inlineTokens = marked.Lexer.lexInline(normalizeUnterminatedCodeFence(text)) as MarkdownToken[];
  if (inlineTokens.length === 0) return splitTextByLine(text);
  return inlineTokens.flatMap((token, index) => renderMarkdownInlineToken(token, index));
}

function renderMarkdownInlineToken(token: MarkdownToken, index: number): Child[] {
  if (!isMarkdownToken(token)) {
    return [];
  }

  if (token.type === "text") {
    return splitTextByLine(tokenField(token, "text", ""));
  }
  if (token.type === "strong") {
    return [<strong key={`md-strong-${index}`}>{renderMarkdownInlines(tokenChildren(token))}</strong>];
  }
  if (token.type === "em") {
    return [<em key={`md-em-${index}`}>{renderMarkdownInlines(tokenChildren(token))}</em>];
  }
  if (token.type === "codespan") {
    return [<code class="md-inline" key={`md-code-${index}`}>{tokenField(token, "text", "")}</code>];
  }
  if (token.type === "link") {
    const href = sanitizeMarkdownHref(tokenField<string>(token, "href", ""));
    if (href) {
      return [
        <a href={href} target="_blank" rel="noopener noreferrer" key={`md-link-${index}`}>
          {tokenChildren(token).length > 0 ? renderMarkdownInlines(tokenChildren(token)) : tokenField(token, "text", "")}
        </a>,
      ];
    }

    return splitTextByLine(tokenField<string>(token, "text", ""));
  }
  if (token.type === "del") {
    return [<del key={`md-del-${index}`}>{renderMarkdownInlines(tokenChildren(token))}</del>];
  }
  if (token.type === "br") {
    return [<br key={`md-br-${index}`} />];
  }
  if (token.type === "html") {
    return splitTextByLine(tokenField(token, "raw", tokenField<string>(token, "text", "")));
  }

  return tokenField(token, "text", "") ? splitTextByLine(tokenField(token, "text", "")) : [];
}

function tokenChildren(token: MarkdownToken): MarkdownToken[] {
  const children = token.tokens;
  if (Array.isArray(children)) {
    return children as MarkdownToken[];
  }
  return [];
}

function listItems(token: MarkdownToken): MarkdownToken[] {
  const items = token.items;
  if (Array.isArray(items)) {
    return items as MarkdownToken[];
  }
  return [];
}

function tokenField<T>(token: MarkdownToken, key: string, fallback: T): T {
  const candidate = token[key];
  if (typeof candidate === "string" && typeof fallback === "string") {
    return candidate as T;
  }
  if (typeof candidate === "number" && typeof fallback === "number") {
    return candidate as T;
  }
  if (typeof candidate === "boolean" && typeof fallback === "boolean") {
    return candidate as T;
  }
  return fallback;
}

function tokenChildrenExists(token: MarkdownToken) {
  const children = tokenChildren(token);
  return children.length > 0;
}

function isMarkdownToken(value: unknown): value is MarkdownToken {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MarkdownToken).type === "string"
  );
}

function isMarkdownBlockToken(type: string) {
  return (
    type === "heading" ||
    type === "paragraph" ||
    type === "list" ||
    type === "list_item" ||
    type === "blockquote" ||
    type === "code"
  );
}

function getListItems(listTokenChildren: MarkdownToken[], legacyItems: MarkdownToken[]) {
  if (listTokenChildren.length > 0) {
    return listTokenChildren;
  }
  return legacyItems;
}

function sanitizeMarkdownHref(rawHref: string) {
  try {
    const href = new URL(rawHref, "https://example.invalid");
    if (href.protocol === "http:" || href.protocol === "https:") {
      return rawHref;
    }
    return "";
  } catch {
    return "";
  }
}

function normalizeUnterminatedCodeFence(text: string) {
  const lines = text.split(/\r?\n/);
  let inFence = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
  }

  if (!inFence) return text;
  return `${text}\n\`\`\``;
}
