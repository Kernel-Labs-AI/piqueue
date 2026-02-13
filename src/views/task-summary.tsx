import type { Task } from "../db/schema.js";
import { formatTimestamp } from "./format.js";
import { renderOutputContainer } from "./output.js";
import { formatMeta, joinMeta } from "./view-utils.js";
import { hx } from "./htmx.js";

export function taskSummaryView(task: Task) {
  const isRunning = task.status === "running";

  const inlineMeta: string[] = [];
  if (task.externalId) inlineMeta.push(task.externalId);
  inlineMeta.push(formatTimestamp(task.createdAt));

  const meta = [
    { label: "Created", value: formatTimestamp(task.createdAt) },
  ];
  if (task.startedAt) meta.push({ label: "Started", value: formatTimestamp(task.startedAt) });
  if (task.completedAt) meta.push({ label: "Completed", value: formatTimestamp(task.completedAt) });
  if (task.gitBranch) meta.push({ label: "Branch", value: task.gitBranch });

  return (
    <>
      <div id="task-status-badge" hx-swap-oob="true" class={`badge badge-${task.status}`}>
        {task.status}
      </div>
      <div id="panel-status" hx-swap-oob="true" class={`panel-status panel-status-${task.status}`}>
        {task.status}
      </div>
      <div id="task-inline-meta" hx-swap-oob="true" class="detail-meta-row">
        {joinMeta(inlineMeta)}
      </div>
      <div id="task-meta-grid" hx-swap-oob="true" class="meta-grid">
        {formatMeta(meta)}
      </div>
      <div id="task-output-container" hx-swap-oob="true">
        {renderOutputContainer(task.output, isRunning, `/tasks/${task.id}/output`, false)}
      </div>
      <div
        id="task-poller"
        hx-swap-oob="true"
        {...(isRunning
          ? hx({ "hx-get": `/tasks/${task.id}/summary`, "hx-trigger": "every 1s", "hx-swap": "none" })
          : {})}
      ></div>
    </>
  );
}
