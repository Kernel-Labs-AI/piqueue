import { execFile } from "child_process";
import { promisify } from "util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export interface AwtTask {
  taskId: string;
  worktreePath: string;
  branch: string;
}

export async function awtStartTask(title: string): Promise<AwtTask> {
  const { stdout } = await execFileAsync(
    "awt",
    ["task", "start", `--agent=pi-queue`, `--title=${title}`],
    { cwd: config.repoPath }
  );

  // awt task start outputs JSON with task info
  // Parse the output to extract task ID, worktree path, and branch
  const lines = stdout.trim().split("\n");

  let taskId = "";
  let worktreePath = "";
  let branch = "";

  for (const line of lines) {
    // Try JSON parse first
    try {
      const parsed = JSON.parse(line);
      if (parsed.id) taskId = parsed.id;
      if (parsed.taskId) taskId = parsed.taskId;
      if (parsed.worktreePath || parsed.worktree_path) {
        worktreePath = parsed.worktreePath || parsed.worktree_path;
      }
      if (parsed.branch) branch = parsed.branch;
      break;
    } catch {
      // Parse key: value lines (handles leading whitespace and case variations)
      const match = line.match(/^\s*(\w[\w_]*)\s*[:=]\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        const k = key.toLowerCase();
        const v = value.trim();
        if (k === "id" || k === "taskid" || k === "task_id") taskId = v;
        if (k === "worktreepath" || k === "worktree_path" || k === "worktree" || k === "path") worktreePath = v;
        if (k === "branch") branch = v;
      }
    }
  }

  // If parsing failed, try to extract from raw output
  if (!taskId) {
    // Look for a UUID or ID pattern
    const idMatch = stdout.match(/[a-f0-9-]{8,}/i);
    if (idMatch) taskId = idMatch[0];
  }

  if (!worktreePath || !taskId) {
    throw new Error(`Failed to parse awt output: ${stdout}`);
  }

  return { taskId, worktreePath, branch };
}

export async function awtCommitTask(taskId: string, title: string): Promise<void> {
  await execFileAsync(
    "awt",
    ["task", "commit", taskId, "--all", "-m", `feat: ${title}`],
    { cwd: config.repoPath }
  );
}

export async function pushBranch(
  worktreePath: string,
  branch: string,
): Promise<void> {
  // Use raw env var — config.gitRepoUrl strips the PAT
  const repoUrl = process.env.GIT_REPO_URL;
  if (!repoUrl) {
    throw new Error("GIT_REPO_URL is not configured");
  }

  await execFileAsync("git", ["push", repoUrl, `HEAD:refs/heads/${branch}`], {
    cwd: worktreePath,
  });
}

export function getCompareUrl(branch: string): string | null {
  const repoUrl = config.gitRepoUrl || process.env.GIT_REPO_URL;
  if (!repoUrl) return null;

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return null;

  const [, owner, repo] = match;
  return `https://github.com/${owner}/${repo}/compare/main...${encodeURIComponent(branch)}?expand=1`;
}

export async function awtTaskStatus(taskId: string): Promise<string> {
  const { stdout } = await execFileAsync("awt", ["task", "status", taskId], {
    cwd: config.repoPath,
  });
  return stdout.trim();
}
