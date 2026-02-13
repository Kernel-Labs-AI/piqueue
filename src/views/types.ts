import type { renderToString } from "hono/jsx/dom/server";

type ViewChild = Parameters<typeof renderToString>[0];

export type ViewProps = {
  title: string;
};

export type ViewChildren = ViewChild | ViewChild[];

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
