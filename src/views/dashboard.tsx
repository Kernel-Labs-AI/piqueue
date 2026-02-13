import type { Task } from "../db/schema.js";
import { renderOutputContainer } from "./output.js";
import { hx } from "./htmx.js";

export function dashboardView(
  pendingTasks: Task[],
  runningTask: Task | undefined,
  recentTasks: Task[]
){
  return (
    <div class="dashboard-grid">
      <section class="dash-col">
        <div class="dash-col-header">
          <span>Running</span>
        </div>
        {runningTaskSection(runningTask)}
      </section>
      <section class="dash-col">
        <div class="dash-col-header">
          <span>Pending</span>
          <span class="dash-count">{pendingTasks.length}</span>
        </div>
        {pendingSection(pendingTasks)}
      </section>
      <section class="dash-col">
        <div class="dash-col-header">
          <span>Recent</span>
          <span class="dash-count">{recentTasks.filter((t) => t.status !== "pending").length}</span>
        </div>
        {recentSection(recentTasks)}
      </section>
    </div>
  );
}

function runningTaskSection(task: Task | undefined) {
  if (!task) {
    return <div class="dash-empty">No task currently running</div>;
  }

  return (
    <div class="dash-card dash-card-running">
      <div class="dash-card-header">
        <a href={`/tasks/${task.id}`} class="dash-title">
          {task.title}
        </a>
        <span class="badge badge-running">running</span>
      </div>
      <div class="dash-output">
        {renderOutputContainer(task.output, true, `/tasks/${task.id}/output`)}
      </div>
    </div>
  );
}

function pendingSection(tasks: Task[]) {
  if (tasks.length === 0) {
    return <div class="dash-empty">No tasks pending review</div>;
  }

  return tasks.map((t) => (
    <div class="dash-card" id={`task-${t.id}`}>
      <div class="dash-card-header">
        <a href={`/tasks/${t.id}`} class="dash-title">
          {t.title}
        </a>
        <div class="actions">
          <button
            class="btn btn-approve"
            {...hx({
              "hx-post": `/api/tasks/${t.id}/approve`,
              "hx-swap": "none",
              "hx-on::after-request": "this.closest('.dash-card').remove()",
            })}
          >
            Approve
          </button>
          <button
            class="btn btn-reject"
            {...hx({
              "hx-post": `/api/tasks/${t.id}/reject`,
              "hx-swap": "none",
              "hx-on::after-request": "this.closest('.dash-card').remove()",
            })}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  ));
}

function recentSection(tasks: Task[]) {
  const filtered = tasks.filter((t) => t.status !== "pending");
  if (filtered.length === 0) {
    return <div class="dash-empty">No tasks yet</div>;
  }

  return filtered.map((t) => (
    <div class="dash-card" id={`task-${t.id}`}>
      <a href={`/tasks/${t.id}`} class="dash-title">
        {t.title}
      </a>
      <div class="dash-card-actions">
        {t.pullRequestUrl ? (
          <a
            href={t.pullRequestUrl}
            target="_blank"
            rel="noopener"
            class="badge badge-pr btn-pr-link"
          >
            <span class="gh-icon" aria-hidden="true"></span>
            See PR
          </a>
        ) : null}
        <span class={`badge badge-${t.status}`}>{t.status}</span>
        <button
          class="btn btn-ghost"
          {...hx({
            "hx-post": `/api/tasks/${t.id}/archive`,
            "hx-swap": "none",
            "hx-on::after-request": "this.closest('.dash-card').remove()",
          })}
        >
          Archive
        </button>
      </div>
    </div>
  ));
}
