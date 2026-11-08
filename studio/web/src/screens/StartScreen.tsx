import { ArrowLeft, AudioLines, FileAudio, Upload } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { api, type ModelSize, type ModelsState } from "../api";
import { ModelPicker } from "../components/ModelPicker";
import { Button } from "../components/ui";

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
            "mt-6 flex h-64 w-full flex-col items-center justify-center rounded-panel border-2 border-dashed px-6 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-line-strong hover:border-faint hover:bg-panel",
          )}
        >
          {file ? (
            <FileAudio size={36} className="text-accent" />
          ) : (
            <Upload size={36} className={dragging ? "text-accent" : "text-muted"} />
          )}
          <span className="mt-3 max-w-full truncate text-lg font-medium text-content">
            {file ? file.name : "Drop an audio file here"}
          </span>
          <span className="mt-1 text-[13px] text-muted">
            {file ? "Click to choose a different file" : "or click to browse"}
          </span>
          {!file && <span className="mt-3 text-xs text-faint">MP3, WAV, FLAC, OGG or M4A</span>}
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
