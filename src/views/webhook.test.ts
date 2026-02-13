import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { webhookView } from "./webhook.js";

describe("webhookView", () => {
  const secret = "test-secret-value-1234";
  const webhookUrl = "https://example.com/api/tasks";

  it("renders webhook-url, webhook-curl, and secret display elements", () => {
    const html = renderToString(webhookView({ webhookSecret: secret, webhookUrl }));
    expect(html).toContain('id="webhook-url"');
    expect(html).toContain('id="webhook-curl"');
    expect(html).toContain('id="webhook-secret-display"');
  });

  it("passes the secret, masked value, and webhook URL via data attributes", () => {
    const html = renderToString(webhookView({ webhookSecret: secret, webhookUrl }));
    expect(html).toContain('data-secret="test-secret-value-1234"');
    expect(html).toContain("data-masked=");
    expect(html).toContain(`data-url="${webhookUrl}"`);
    expect(html).toMatch(/data-masked="test.*1234"/);
  });

  it("renders copy targets and reveal button", () => {
    const html = renderToString(webhookView({ webhookSecret: secret, webhookUrl }));
    expect(html).toContain('data-copy="webhook-url"');
    expect(html).toContain('data-copy="secret"');
    expect(html).toContain('data-copy="webhook-curl"');
    expect(html).toContain('id="reveal-btn"');
  });

  it("renders test form inputs and submit button", () => {
    const html = renderToString(webhookView({ webhookSecret: secret, webhookUrl }));
    expect(html).toContain('id="webhook-test-form"');
    expect(html).toContain('id="webhook-test-title"');
    expect(html).toContain('id="webhook-test-prompt"');
    expect(html).toContain('id="webhook-test-status"');
    expect(html).toContain('id="webhook-test-btn"');
    expect(html).toContain("Test it out");
  });

  it("escapes dangerous characters in HTML attributes and text nodes", () => {
    const dangerous = renderToString(
      webhookView({ webhookSecret: `ab<>"'&cd`, webhookUrl: `https://example.com/api?x=<script>` })
    );
    expect(dangerous).toContain("&lt;");
    expect(dangerous).toContain("&gt;");
    expect(dangerous).toContain("&amp;");
    expect(dangerous).toContain("&quot;");
    expect(dangerous).toContain("&#39;");
    expect(dangerous).not.toMatch(/data-secret="[^"]*[<>]/);
  });
});
