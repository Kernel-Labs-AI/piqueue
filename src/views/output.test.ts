import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { renderOutputTimeline } from "./output.js";

describe("output markdown rendering", () => {
  it("renders heading, lists, bold, inline code, and links", () => {
    const html = renderToString(
      renderOutputTimeline("## Deploy summary\n- list item\n1. numbered item\nStatus: **ready** and `ok` see [docs](https://example.com)", false)
    );

    expect(html).toContain("<h2>Deploy summary</h2>");
    expect(html).toContain('<ul class="md-list"');
    expect(html).toContain("<li>list item</li>");
    expect(html).toContain('<ol class="md-list"');
    expect(html).toContain("<li>numbered item");
    expect(html).toContain("<strong>ready</strong>");
    expect(html).toContain('<code class="md-inline">ok</code>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(">docs</a>");
  });

  it("supports unterminated code fences", () => {
    const html = renderToString(renderOutputTimeline("```bash\nnpm test", false));
    expect(html).toContain("<pre class=\"md-code\">");
    expect(html).toContain('data-lang="bash"');
    expect(html).toContain('class="language-bash"');
    expect(html).toContain("npm test");
  });

  it("renders read tool output as highlighted code block", () => {
    const html = renderToString(
      renderOutputTimeline(">>> Running: Read — package.json\n{\n  \"name\": \"demo\"\n}\n<<< Done", false)
    );

    expect(html).toContain('data-tool-id="tool-0"');
    expect(html).toContain('class="output-item-body output-item-body-md"');
    expect(html).toContain("<pre class=\"md-code\">");
    expect(html).toContain('data-lang="json"');
    expect(html).toContain('class="language-json"');
    expect(html).toContain("{");
  });

  it("wraps non-read tool output in a code block", () => {
    const html = renderToString(
      renderOutputTimeline(">>> Running: bash — echo hello\nhello from tool\n<<< Done", false)
    );

    expect(html).toContain('class="output-item-body output-item-body-md"');
    expect(html).toContain("<pre class=\"md-code\">");
    expect(html).toContain('data-lang="bash"');
    expect(html).toContain('class="language-bash"');
    expect(html).toContain("hello from tool");
    expect(html).toContain('data-tool-name="bash"');
    expect(html).toContain('data-tool-command="echo hello"');
    expect(html).toContain('data-tool-lang="bash"');
  });

  it("derives read language from the actual file path when command has flags", () => {
    const html = renderToString(
      renderOutputTimeline(">>> Running: Read — /tmp/src/main.ts --raw\nconsole.log(\"hi\")\n<<< Done", false)
    );

    expect(html).toContain('data-tool-command="/tmp/src/main.ts --raw"');
    expect(html).toContain('data-lang="typescript"');
    expect(html).toContain('class="language-typescript"');
    expect(html).toContain("console.log(&quot;hi&quot;)");
  });

  it("derives read language when command path includes line and column suffixes", () => {
    const html = renderToString(
      renderOutputTimeline(">>> Running: Read — src/runtime/worker.ts:41:2\nconst ready = true;\n<<< Done", false)
    );

    expect(html).toContain('data-tool-command="src/runtime/worker.ts:41:2"');
    expect(html).toContain('data-lang="typescript"');
    expect(html).toContain('class="language-typescript"');
  });

  it("escapes dangerous plain text", () => {
    const html = renderToString(renderOutputTimeline("<script>alert(1)</script>", false));
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("alert(1)");
    expect(html).toContain("&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
