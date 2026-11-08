import type { ProjectSummary } from "./api";

export type LibraryStatus = "ready" | "completed" | "partial";
export type StatusFilter = LibraryStatus | "all";

export const ROWS_PER_PAGE = [10, 20, 50, 100];
export const DEFAULT_ROWS = 20;

export const STATUS_LABEL: Record<LibraryStatus, string> = {
  ready: "Ready to continue",
  completed: "Completed",
  partial: "Stopped early",
};

/** A project left "transcribing" has nothing running: it starts again when opened. */
export function statusOf(project: Pick<ProjectSummary, "status">): LibraryStatus {
  if (project.status === "completed") return "completed";
  return project.status === "partial" ? "partial" : "ready";
}

export const isReady = (project: Pick<ProjectSummary, "status">) => statusOf(project) === "ready";

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Whether the name contains `text`, ignoring case and accents. */
export function matchesSearch(project: Pick<ProjectSummary, "name">, text: string): boolean {
  return plain(project.name).includes(plain(text.trim()));
}

export function sortByOpened<T extends Pick<ProjectSummary, "opened">>(rows: T[], newestFirst: boolean): T[] {
  const sign = newestFirst ? -1 : 1;
  return [...rows].sort((a, b) => sign * (a.opened - b.opened));
}

/** One page of `rows`, and the page number after keeping it in range. */
export function pageOf<T>(rows: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** How long ago `seconds` (Unix time) was, as of `now`. */
export function timeAgo(seconds: number, now: number): string {
  const past = Math.max(0, now - seconds);
  if (past < 60) return "just now";
  if (past < 3600) return count(Math.floor(past / 60), "minute");
  if (past < 86400) return count(Math.floor(past / 3600), "hour");
  const days = Math.floor(past / 86400);
  return days === 1 ? "yesterday" : count(days, "day");
}

export function formatLength(seconds: number): string {
  const total = Math.round(seconds);
  const rest = `${String(Math.floor(total / 60) % 60)}:${String(total % 60).padStart(2, "0")}`;
  if (total < 3600) return rest;
  return `${Math.floor(total / 3600)}:${rest.padStart(5, "0")}`;
}

export function formatSize(bytes: number): string {
  const mib = bytes / 1024 / 1024;
  return mib >= 1 ? `${mib.toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/** The details under a name, leaving out what isn't known or doesn't apply. */
export const details = (parts: (string | null | false)[]) => parts.filter(Boolean).join(" · ");
