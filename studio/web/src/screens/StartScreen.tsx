import { ArrowLeft, AudioLines, FileAudio } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { api, type ModelSize, type ModelsState } from "../api";
import { PALETTE } from "../colors";
import { ModelPicker } from "../components/ModelPicker";
import { Button } from "../components/ui";

/** A strip of piano roll, to show at a glance what this tool makes. */
const ROLL = [
  [2, 1, 14, 0], [18, 1, 9, 0], [30, 3, 18, 1], [52, 1, 11, 0], [66, 2, 13, 2], [82, 0, 9, 3],
  [6, 5, 10, 4], [20, 6, 7, 4], [31, 5, 12, 4], [47, 6, 16, 4], [68, 5, 15, 4], [86, 6, 11, 4],
  [10, 8, 25, 2], [38, 9, 20, 5], [62, 8, 24, 2], [90, 9, 8, 5],
];

function RollStrip() {
  return (
    <svg viewBox="0 0 100 11" preserveAspectRatio="none" aria-hidden="true" className="block h-16 w-full">
      {ROLL.map(([x, row, width, color], i) => (
        <rect key={i} x={x} y={row} width={width} height={0.8} rx={0.2} fill={PALETTE[color]} opacity={0.75} />
      ))}
    </svg>
  );
}

export function StartScreen() {
  const [models, setModels] = useState<ModelsState | null>(null);
  const [hasProjects, setHasProjects] = useState(false);
  const [size, setSize] = useState<ModelSize>("medium");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .models()
      .then(setModels)
      .catch(() => setError("The MuScriptor server isn't responding. Start it with start-studio.bat."));
    api.projects().then((projects) => setHasProjects(projects.length > 0), () => {});
  }, []);

  async function start() {
    if (!file) return;
    setError(null);
    try {
      setStatus("Uploading");
      const doc = await api.createProject(file, size);
      window.location.hash = `#/p/${doc.id}`;
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="mx-auto grid min-h-full max-w-2xl content-center px-6 py-10">
      <section>
        {hasProjects && (
          <a href="#/" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-content">
            <ArrowLeft size={14} />
            Library
          </a>
        )}
        <h1 className="flex items-center gap-2.5 text-[26px] leading-tight font-semibold text-content">
          <AudioLines size={26} className="text-accent" />
          MuScriptor Studio
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">Turn a recording into notes you can edit, hear and export.</p>

        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setFile(e.dataTransfer.files[0] ?? null);
          }}
          className={clsx(
            "mt-6 block w-full overflow-hidden rounded-panel border text-left transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-panel hover:border-faint",
          )}
        >
          <span className="block px-5 pt-5 pb-4">
            <span className="flex items-center gap-2 text-[15px] font-medium text-content">
              <FileAudio size={18} className="text-muted" />
              {file ? file.name : "Drop an audio file here"}
            </span>
            <span className="mt-0.5 block text-[13px] text-muted">
              {file ? "Click to choose a different file" : "or click to choose one. MP3, WAV, FLAC, OGG and M4A all work."}
            </span>
          </span>
          <RollStrip />
        </button>
        <input
          ref={input}
          type="file"
          aria-label="Audio file"
          accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        {models && (
          <div className="mt-5">
            <ModelPicker models={models.models} value={size} onChange={setSize} />
            <div className="mt-4 flex justify-end">
              <Button variant="primary" disabled={!file || status !== null} onClick={start}>
                {status ?? "Continue"}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-danger">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
