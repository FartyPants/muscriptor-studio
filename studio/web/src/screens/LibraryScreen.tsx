import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileAudio, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type ProjectSummary } from "../api";
import { Button, IconButton, Modal, Select } from "../components/ui";
import {
  DEFAULT_ROWS,
  ROWS_PER_PAGE,
  STATUS_LABEL,
  details,
  formatLength,
  formatSize,
  isReady,
  matchesSearch,
  pageOf,
  sortByOpened,
  statusOf,
  timeAgo,
  type LibraryStatus,
  type StatusFilter,
} from "../library";

const ROWS_KEY = "studio.library.rows";

function loadRows(): number {
  try {
    const saved = Number(localStorage.getItem(ROWS_KEY));
    return ROWS_PER_PAGE.includes(saved) ? saved : DEFAULT_ROWS;
  } catch {
    return DEFAULT_ROWS;
  }
}

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "ready", label: STATUS_LABEL.ready },
  { value: "completed", label: STATUS_LABEL.completed },
  { value: "partial", label: STATUS_LABEL.partial },
];

function StatusBadge({ status }: { status: LibraryStatus }) {
  const color = status === "completed" ? "text-ok" : "text-warn";
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", color)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function ProjectName({ project, detail }: { project: ProjectSummary; detail: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <FileAudio size={15} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0">
        <a href={`#/p/${project.id}`} className="block truncate text-[13px] font-medium text-content hover:underline">
          {project.name}
        </a>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}

const open = (project: ProjectSummary) => {
  window.location.hash = `#/p/${project.id}`;
};

function DeleteDialog(props: {
  project: ProjectSummary;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { project, onDeleted, onClose } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteProject(project.id);
      onDeleted();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal title={`Delete "${project.name}"?`} onClose={onClose}>
      <p className="text-[13px] text-muted">This removes its notes and audio from this computer. It can't be undone.</p>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={confirm}>
          Delete
        </Button>
      </div>
    </Modal>
  );
}

/** Every project: search it, filter it, and pick one up where it was left. */
export function LibraryScreen() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [size, setSize] = useState(loadRows);
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const now = Date.now() / 1000;

  useEffect(() => {
    api.projects().then(setProjects, () => setError("The MuScriptor server isn't responding. Start it with start-studio.bat."));
  }, []);

  // With nothing to list, the way in is an upload.
  useEffect(() => {
    if (projects?.length === 0) window.location.replace("#/new");
  }, [projects]);

  const found = useMemo(
    () => (projects ?? []).filter((p) => matchesSearch(p, search) && (filter === "all" || statusOf(p) === filter)),
    [projects, search, filter],
  );
  const ready = useMemo(() => sortByOpened(found.filter(isReady), true), [found]);
  const others = useMemo(() => sortByOpened(found.filter((p) => !isReady(p)), newestFirst), [found, newestFirst]);
  const shown = pageOf(others, page, size);

  const startOver = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };
  const deleteButton = (project: ProjectSummary) => (
    <IconButton
      label={`Delete ${project.name}`}
      onClick={(e) => {
        e.stopPropagation();
        setDeleting(project);
      }}
    >
      <Trash2 size={15} />
    </IconButton>
  );
  const chooseSize = startOver((rows: number) => {
    setSize(rows);
    try {
      localStorage.setItem(ROWS_KEY, String(rows));
    } catch {
      // A remembered preference is a convenience.
    }
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold text-content">MuScriptor Studio</h1>
          <p className="mt-1 text-[15px] text-muted">Turn a recording into notes you can edit, hear and export.</p>
        </div>
        <a
          href="#/new"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control bg-content px-3.5 text-[13px] font-medium text-ink hover:opacity-90"
        >
          <Plus size={15} />
          New transcription
        </a>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <label className="relative block min-w-0 flex-1 sm:max-w-64">
          <span className="sr-only">Search name</span>
          <Search size={14} className="pointer-events-none absolute top-2.5 left-2.5 text-muted" />
          <input
            type="search"
            placeholder="Search name"
            value={search}
            onChange={(e) => startOver(setSearch)(e.target.value)}
            className="h-8 w-full rounded-control border border-line-strong bg-ink pr-2.5 pl-8 text-[13px] text-content outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
        <Select
          label="Status"
          hideLabel
          value={filter}
          options={FILTERS}
          onChange={startOver(setFilter)}
          className="w-44"
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 text-[13px] text-danger">
          {error}
        </p>
      )}

      {projects && found.length === 0 && projects.length > 0 && (
        <p className="mt-6 text-[13px] text-muted">No transcriptions match.</p>
      )}

      {ready.length > 0 && (
        <section aria-label="Ready to continue" className="mt-4 rounded-panel border border-line bg-panel">
          <h2 className="border-b border-line px-4 py-2.5 text-xs font-medium text-muted">Ready to continue</h2>
          <ul className="divide-y divide-line">
            {ready.map((project) => {
              const hints = project.hints?.length ?? 0;
              return (
                <li key={project.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                    <ProjectName
                      project={project}
                      detail={details([
                        project.duration != null && formatLength(project.duration),
                        formatSize(project.audio_size),
                        hints > 0 && `${hints} ${hints === 1 ? "hint" : "hints"}`,
                      ])}
                    />
                    <p className="mt-0.5 pl-[25px] text-xs text-faint">Ready {timeAgo(project.created, now)}</p>
                  </div>
                  <StatusBadge status="ready" />
                  <a
                    href={`#/p/${project.id}`}
                    className="inline-flex h-8 items-center rounded-control border border-line-strong px-3 text-[13px] font-medium text-content hover:bg-raised"
                  >
                    Continue
                  </a>
                  {deleteButton(project)}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section aria-label="Transcriptions" className="mt-4 rounded-panel border border-line bg-panel">
          <table className="w-full table-fixed text-left">
            <thead>
              <tr className="border-b border-line text-xs font-medium text-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Name
                </th>
                <th
                  scope="col"
                  aria-sort={newestFirst ? "descending" : "ascending"}
                  className="hidden w-36 py-2.5 font-medium sm:table-cell"
                >
                  <button
                    type="button"
                    onClick={() => startOver(setNewestFirst)(!newestFirst)}
                    className="inline-flex items-center gap-1 hover:text-content"
                  >
                    Last opened
                    {newestFirst ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                  </button>
                </th>
                <th scope="col" className="hidden w-32 py-2.5 font-medium md:table-cell">
                  Created
                </th>
                <th scope="col" className="w-32 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="w-12 py-2.5 pr-2 font-medium">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.rows.map((project) => (
                <tr key={project.id} onClick={() => open(project)} className="cursor-pointer hover:bg-raised">
                  <td className="px-4 py-2.5">
                    <ProjectName
                      project={project}
                      detail={details([
                        project.duration != null && formatLength(project.duration),
                        `${project.note_count.toLocaleString()} notes`,
                      ])}
                    />
                  </td>
                  <td className="hidden py-2.5 text-[13px] text-muted sm:table-cell">{timeAgo(project.opened, now)}</td>
                  <td className="hidden py-2.5 text-[13px] text-muted md:table-cell">{timeAgo(project.created, now)}</td>
                  <td className="py-2.5">
                    <StatusBadge status={statusOf(project)} />
                  </td>
                  <td className="py-2.5 pr-2">{deleteButton(project)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {others.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-panel px-4 py-2.5">
          <p className="text-[13px] text-muted">
            {shown.rows.length} {shown.rows.length === 1 ? "transcription" : "transcriptions"} on this page
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted">Rows per page</span>
            <Select
              label="Rows per page"
              hideLabel
              value={size}
              options={ROWS_PER_PAGE.map((value) => ({ value, label: String(value) }))}
              onChange={chooseSize}
              className="w-20"
            />
            <IconButton label="Previous page" disabled={shown.page <= 1} onClick={() => setPage(shown.page - 1)}>
              <ChevronLeft size={15} />
            </IconButton>
            <IconButton label="Next page" disabled={shown.page >= shown.pages} onClick={() => setPage(shown.page + 1)}>
              <ChevronRight size={15} />
            </IconButton>
          </div>
        </div>
      )}

      {deleting && (
        <DeleteDialog
          key={deleting.id}
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setProjects((all) => all?.filter((p) => p.id !== deleting.id) ?? null);
            setDeleting(null);
          }}
        />
      )}
    </main>
  );
}
