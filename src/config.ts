function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOrigin(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function sanitizeRepoUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    // Avoid leaking credentials anywhere in UI rendering.
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "";
  }
}

const nodeEnv = process.env.NODE_ENV || "";
const isDev = nodeEnv === "development" || nodeEnv === "test";
const inferredPublicOriginFromFly = process.env.FLY_APP_NAME
  ? `https://${process.env.FLY_APP_NAME}.fly.dev`
  : undefined;

export const config = {
  nodeEnv,
  isDev,
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  apiAccessToken: process.env.API_ACCESS_TOKEN || "",
  publicOrigin: parseOrigin(process.env.PUBLIC_ORIGIN || inferredPublicOriginFromFly),
  apiMaxPageSize: parsePositiveInt(process.env.API_MAX_PAGE_SIZE, 100),
  apiMaxOffset: parsePositiveInt(process.env.API_MAX_OFFSET, 10_000),
  apiMaxTitleLength: parsePositiveInt(process.env.API_MAX_TITLE_LENGTH, 200),
  apiMaxPromptLength: parsePositiveInt(process.env.API_MAX_PROMPT_LENGTH, 20_000),
  apiMaxSourceLength: parsePositiveInt(process.env.API_MAX_SOURCE_LENGTH, 64),
  apiMaxExternalIdLength: parsePositiveInt(process.env.API_MAX_EXTERNAL_ID_LENGTH, 128),
  apiMaxRejectReasonLength: parsePositiveInt(process.env.API_MAX_REJECT_REASON_LENGTH, 1_000),
  apiMaxMetadataBytes: parsePositiveInt(process.env.API_MAX_METADATA_BYTES, 16_384),
  piBinary: process.env.PI_BINARY || "pi",
  taskTimeoutMs: parseInt(process.env.TASK_TIMEOUT_MS || "600000", 10),
  repoPath: process.env.REPO_PATH || process.cwd(),
  databasePath: process.env.DATABASE_PATH || "./data/pi-queue.db",
  defaultPriority: parseInt(process.env.DEFAULT_PRIORITY || "0", 10),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  dashboardUser: process.env.DASHBOARD_USER || "",
  dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
  gitRepoUrl: sanitizeRepoUrl(process.env.GIT_REPO_URL),
} as const;
