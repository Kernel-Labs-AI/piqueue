import { config } from "../config.js";
import type { ViewChildren } from "./types.js";

export function layout(title: string, content: ViewChildren) {
  const repoUrl = config.gitRepoUrl;

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark-dimmed.min.css"
        />
        <script defer src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
        <script defer src="/assets/js/syntax-highlight.js"></script>
        <script defer src="https://unpkg.com/htmx.org@2.0.4"></script>
        <script type="module" src="/assets/js/dashboard.js"></script>
        <script type="module" src="/assets/js/webhook.js"></script>
        <link rel="stylesheet" href="/assets/css/app.css" />
      </head>
      <body>
        <header>
          <div class="container">
          <h1>
              <a href="/" class="header-home-link">
                Pi-Queue
              </a>
              {repoUrl ? (
                <a href={repoUrl} target="_blank" rel="noopener" class="repo-link">
                  {repoUrl.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              ) : null}
            </h1>
            <nav>
              <a href="/webhook" class="btn-copy-webhook">
                Webhook Instructions
              </a>
            </nav>
          </div>
        </header>
        <main class="container">{content}</main>
      </body>
    </html>
  );
}
