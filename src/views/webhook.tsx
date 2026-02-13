export type WebhookPageModel = {
  webhookSecret: string;
  webhookUrl: string;
};

export function webhookView(model: WebhookPageModel) {
  const masked =
    model.webhookSecret.length > 8
      ? `${model.webhookSecret.slice(0, 4)}${"\u2022".repeat(model.webhookSecret.length - 8)}${model.webhookSecret.slice(-4)}`
      : "\u2022".repeat(model.webhookSecret.length);

  return (
    <>
      <a href="/" class="back-link">&larr; Dashboard</a>
      <div
        class="detail-card"
        id="webhook-page"
        data-secret={model.webhookSecret}
        data-masked={masked}
        data-url={model.webhookUrl}
      >
        <div class="detail-top">
          <h2 class="detail-title">Webhook Instructions</h2>
          <p class="detail-meta-row">Use these values to send tasks to Pi-Queue from external services.</p>
        </div>

        <div class="detail-body webhook-body">
          <div class="info-section">
            <div class="info-label">Webhook URL</div>
            <div class="webhook-copy-row">
              <code class="webhook-value" id="webhook-url"></code>
              <button class="btn btn-copy" data-copy="webhook-url">
                Copy
              </button>
            </div>
          </div>

          <div class="info-section">
            <div class="info-label">Webhook Secret</div>
            <div class="webhook-copy-row">
              <code class="webhook-value">
                <span id="webhook-secret-display">{masked}</span>
                <button class="btn-reveal" id="reveal-btn" type="button">
                  reveal
                </button>
              </code>
              <button class="btn btn-copy" data-copy="secret">
                Copy
              </button>
            </div>
          </div>

          <div class="info-section">
            <div class="info-label">Example cURL Command</div>
            <div class="webhook-copy-row webhook-copy-row-block">
              <code class="webhook-value webhook-value-block" id="webhook-curl"></code>
              <button class="btn btn-copy" data-copy="webhook-curl">
                Copy
              </button>
            </div>
          </div>

          <div class="info-section">
            <div class="info-label">Test it out</div>
            <p class="webhook-test-intro">
              Send a sample task directly using the same credentials.
            </p>
            <form id="webhook-test-form" class="webhook-test-form">
              <label for="webhook-test-title">Title</label>
              <input
                id="webhook-test-title"
                name="title"
                class="webhook-input"
                type="text"
                value="Sample Task"
                required
                maxlength={255}
              />
              <label for="webhook-test-prompt">Prompt</label>
              <textarea
                id="webhook-test-prompt"
                name="prompt"
                class="webhook-textarea"
                required
                maxlength={20000}
              >Say hello to the queue</textarea>
              <div class="webhook-form-actions">
                <button id="webhook-test-btn" class="btn" type="submit">Send test task</button>
              </div>
              <div id="webhook-test-status" class="webhook-status" aria-live="polite"></div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
