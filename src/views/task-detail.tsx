import type { Task } from "../db/schema.js";
import { renderOutputContainer } from "./output.js";
import { formatTimestamp } from "./format.js";
import { formatMeta, joinMeta } from "./view-utils.js";
import { hx } from "./htmx.js";

export function taskDetailView(task: Task) {
  const isRunning = task.status === "running";
  const isPending = task.status === "pending";

  const meta = [
    { label: "Created", value: formatTimestamp(task.createdAt) },
    ...(task.startedAt ? [{ label: "Started", value: formatTimestamp(task.startedAt) }] : []),
    ...(task.completedAt ? [{ label: "Completed", value: formatTimestamp(task.completedAt) }] : []),
    ...(task.gitBranch ? [{ label: "Branch", value: task.gitBranch }] : [])
  ];

  const inlineMeta: string[] = [];
  if (task.externalId) inlineMeta.push(task.externalId);
  inlineMeta.push(formatTimestamp(task.createdAt));

  return (
    <div class="section">
      <a href="/" class="back-link">&larr; Dashboard</a>

      <div class="detail-page">
        <div class="detail-header">
            <div class="detail-title-block">
            <div class="detail-title">{task.title}</div>
              <div class="detail-meta-row" id="task-inline-meta">
                {joinMeta(inlineMeta)}
              </div>
            </div>
            <div class="detail-header-actions">
              {task.pullRequestUrl ? (
                <a
                href={task.pullRequestUrl}
                  target="_blank"
                  rel="noopener"
                  class="btn btn-pr btn-pr-link"
                >
                  <span class="gh-icon" aria-hidden="true"></span>
                  See PR
                </a>
            ) : null}
            <span id="task-status-badge" class={`badge badge-${task.status}`}>
              {task.status}
            </span>
          </div>
        </div>

        {isPending ? (
          <div class="detail-cta">
            <form method="dialog" class="cta-form">
              <button
                class="btn btn-approve"
                {...hx({
                  "hx-post": `/api/tasks/${task.id}/approve`,
                  "hx-swap": "none",
                  "hx-on::after-request": "window.location.reload()",
                })}
              >
                Approve
              </button>
              <button
                class="btn btn-reject"
                {...hx({
                  "hx-post": `/api/tasks/${task.id}/reject`,
                  "hx-swap": "none",
                  "hx-on::after-request": "window.location.reload()",
                })}
              >
                Reject
              </button>
            </form>
          </div>
        ) : null}

        <div
          id="task-poller"
          hx-swap-oob="true"
          {...(isRunning
            ? hx({ "hx-get": `/tasks/${task.id}/summary`, "hx-trigger": "every 1s", "hx-swap": "none" })
            : {})}
        ></div>
        <div class="detail-split">
          <section class="output-panel">
            <div class="panel-head">
              <div>
                <div class="panel-title">Output</div>
                <div class="panel-subtitle">{isRunning ? "Live task stream" : "Final output"}</div>
              </div>
              <div id="panel-status" class={`panel-status panel-status-${task.status}`}>
                {task.status}
              </div>
            </div>
            <div id="task-output-container">
              {renderOutputContainer(task.output, isRunning, `/tasks/${task.id}/output`, false)}
            </div>
          </section>

          <aside class="info-panel">
            <div class="info-section">
              <div class="info-box">{task.prompt}</div>
            </div>

            {task.error ? (
              <div class="info-section">
                <div class="info-label info-label-error">Error</div>
                <div class="info-box info-box-error">{task.error}</div>
              </div>
            ) : null}

            <div class="info-section">
              <div id="task-meta-grid" class="meta-grid">{formatMeta(meta)}</div>
            </div>

            {!isRunning ? (
              <div class="info-footer">
                <span>ID: {task.id}</span>
                <form
                  {...hx({
                    "hx-delete": `/api/tasks/${task.id}`,
                    "hx-swap": "none",
                    "hx-on::after-request": "window.location='/'",
                  })}
                >
                  <button class="btn btn-ghost btn-ghost-danger">Delete task</button>
                </form>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
