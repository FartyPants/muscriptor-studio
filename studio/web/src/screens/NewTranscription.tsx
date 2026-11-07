import { useEffect, useRef, useState } from "react";
import { api, type ModelSize, type ModelsState } from "../api";
import { Button } from "../components/Button";
import { ModelPicker } from "../components/ModelPicker";
import { requestStart } from "../hooks/useProjectTranscription";

export function NewTranscription() {
  const [models, setModels] = useState<ModelsState | null>(null);
  const [size, setSize] = useState<ModelSize>("large");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .models()
      .then((state) => {
        setModels(state);
        if (state.active) setSize(state.active);
      })
      .catch(() => setError("The MuScriptor server is not responding."));
  }, []);

  async function start() {
    if (!file) return;
    setError(null);
    try {
      if (models?.active !== size) {
        setStatus(`Loading the ${size} model. This can take a minute.`);
        await api.chooseModel(size);
      }
      setStatus("Uploading");
      const doc = await api.createProject(file, size);
      requestStart(doc.id);
      window.location.hash = `#/p/${doc.id}`;
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
      api.models().then(setModels, () => {});
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <header>
        <h1 className="text-3xl font-medium tracking-tight text-content">MuScriptor Studio</h1>
        <p className="mt-2 text-sm text-muted">Turn a recording into notes you can edit.</p>
      </header>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setFile(e.dataTransfer.files[0] ?? null);
        }}
        className="rounded-card border border-dashed border-line-strong bg-surface px-4 py-10 text-center text-sm text-muted hover:border-white"
      >
        {file ? <span className="text-content">{file.name}</span> : "Drop an audio file, or click to choose one"}
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
        hidden
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      {models && (
        <ModelPicker
          models={models.models}
          value={size}
          onChange={setSize}
          disabled={status !== null || models.switching}
        />
      )}

      <Button
        kind="primary"
        disabled={!file || !models || status !== null}
        onClick={start}
        className="disabled:opacity-50"
      >
        {status ?? "Transcribe"}
      </Button>

      {error && (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      )}
    </main>
  );
}
