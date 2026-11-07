import { unzipSync } from "fflate";
import { Download, FileMusic, FileText, LoaderCircle, Music4 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ChosenKey, type ProjectDoc, type ProjectNote } from "../api";
import { exportMidi, saveBlob, type NoteCleanup, type TimingOverrides } from "../export";
import { label } from "../instruments";
import { renderAudio } from "../renderAudio";
import { Button, Checkbox, Segmented, Select, SidePanel } from "./ui";

const GRIDS = [
  { value: 0, label: "Automatic" },
  { value: 1, label: "1/4 notes" },
  { value: 2, label: "1/8 notes" },
  { value: 3, label: "1/8 triplets" },
  { value: 4, label: "1/16 notes" },
  { value: 6, label: "1/16 triplets" },
  { value: 8, label: "1/32 notes" },
];

const METERS = [2, 3, 4, 5, 6, 7, 8];

type SheetFile = { name: string; bytes: Uint8Array<ArrayBuffer> };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 pb-5">
      <h3 className="mb-3 text-sm font-semibold text-content">{title}</h3>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

function FormatButton(props: {
  title: string;
  extension: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { title, extension, busy, disabled, onClick } = props;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-14 flex-1 flex-col items-center justify-center rounded-control border border-line-strong text-content transition-colors enabled:hover:bg-raised disabled:opacity-45"
    >
      {busy ? (
        <LoaderCircle size={16} className="animate-spin text-muted" />
      ) : (
        <>
          <span className="text-[13px] font-semibold">{title}</span>
          <span className="text-xs text-muted">{extension}</span>
        </>
      )}
    </button>
  );
}

const fileLabel = (name: string) =>
  name === "full_score.pdf"
    ? "Full score"
    : name
        .replace(/^\d+_/, "")
        .replace(/\.pdf$/, "")
        .replace(/_tab$/, " tablature")
        .replace(/_/g, " ");

export function ExportPanel(props: {
  doc: ProjectDoc;
  notes: ProjectNote[];
  names: string[];
  chosenKey: ChosenKey | null;
  onClose: () => void;
}) {
  const { doc, notes, names, chosenKey, onClose } = props;
  const grid = doc.beat_grid;
  const followable = (grid?.beats?.length ?? 0) >= 2;
  const [tempoMap, setTempoMap] = useState(followable && grid?.steady === false);
  const [quantize, setQuantize] = useState(false);
  const [beatScale, setBeatScale] = useState(1);
  const [meter, setMeter] = useState(grid?.beats_per_bar ?? 4);
  const [rhythm, setRhythm] = useState(0);
  const [chords, setChords] = useState(true);
  const [page, setPage] = useState<"a4" | "letter">("a4");
  const [midiStart, setMidiStart] = useState<"audio" | "bar">("audio");
  const [included, setIncluded] = useState<Set<string>>(() => new Set(names));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetFile[] | null>(null);
  const archive = useRef<Blob | null>(null);

  const selected = useMemo(
    () => notes.filter((n) => included.has(n.instrument)),
    [notes, included],
  );

  const timing: TimingOverrides = {
    bpm: null,
    beats_per_bar: meter === grid?.beats_per_bar ? null : meter,
    first_downbeat: null,
    tempo_map: tempoMap,
    beat_scale: beatScale,
  };
  const cleanup: NoteCleanup = {
    quantize: quantize && grid !== null,
    subdivision: rhythm || null,
    strength: 1,
    fill_gaps: quantize ? 0.25 : 0,
    trim_leading_bars: midiStart === "bar",
  };
  const stem = doc.name;

  async function run(task: string, work: () => Promise<void>) {
    setBusy(task);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const midi = () => exportMidi(selected, grid, timing, cleanup);

  const scoreBody = () => ({
    notes: selected.map(({ instrument, pitch, start, end }) => ({ instrument, pitch, start, end })),
    beat_grid: grid && { ...grid, onset_delay: grid.onset_delay ?? 0, steady: grid.steady ?? true, beats: grid.beats ?? null },
    options: { ...timing, ...cleanup, fill_gaps: 0.25 },
    key: chosenKey,
    chords,
    page,
  });

  // Prepared PDFs show the options they were made with, so they end with them.
  useEffect(() => {
    setSheets(null);
    archive.current = null;
  }, [tempoMap, beatScale, meter, rhythm, chords, page, included]);

  const noneOn = selected.length === 0;
  const anyBusy = busy !== null;

  return (
    <SidePanel
      title="Export"
      subtitle="Download editable files, sheet music or an audio render."
      onClose={onClose}
    >
      {grid ? (
        <Section title="Timing">
          {followable && (
            <Segmented
              label="Bar lines"
              value={tempoMap ? "performance" : "fixed"}
              options={[
                { value: "performance", label: "Follow the performance" },
                { value: "fixed", label: "One fixed tempo" },
              ]}
              onChange={(v) => setTempoMap(v === "performance")}
            />
          )}
          <Checkbox
            label="Quantize"
            hint="Moves notes onto the beat grid. This changes what you hear. Sheet music is always quantized."
            checked={quantize}
            onChange={setQuantize}
          />
          <div>
            <p className="mb-1 text-[13px] font-medium text-content">Beat reading</p>
            <Segmented
              label="Beat reading"
              value={beatScale}
              options={[
                { value: 0.5, label: "Half time" },
                { value: 1, label: "As detected" },
                { value: 2, label: "Double time" },
              ]}
              onChange={setBeatScale}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Meter"
              value={meter}
              options={METERS.map((n) => ({
                value: n,
                label: n === grid.beats_per_bar ? `${n}/4 (detected)` : `${n}/4`,
              }))}
              onChange={setMeter}
            />
            <Select label="Rhythm grid" value={rhythm} options={GRIDS} onChange={setRhythm} />
          </div>
        </Section>
      ) : (
        <p className="mb-4 text-[13px] text-muted">
          No beat grid was found, so bar lines, quantizing and meter aren't available.
        </p>
      )}

      <Section title="What to include">
        <div className="grid grid-cols-2 gap-2">
          {names.map((name) => (
            <Checkbox
              key={name}
              label={label(name).replace(/^./, (c) => c.toUpperCase())}
              checked={included.has(name)}
              onChange={(on) => {
                const next = new Set(included);
                if (on) next.add(name);
                else next.delete(name);
                setIncluded(next);
              }}
            />
          ))}
        </div>
        <Checkbox
          label="Chord symbols"
          hint={
            grid
              ? "Adds detected chords to MusicXML and sheet music."
              : "Needs a beat grid, to place chords on bars."
          }
          checked={chords && grid !== null}
          disabled={!grid}
          onChange={setChords}
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-content">MIDI starts at</p>
            <p className="text-xs text-muted">
              {midiStart === "audio"
                ? "Keeps any empty bars before the first note."
                : "Drops the empty bars before the first note."}
            </p>
          </div>
          <Segmented
            label="MIDI starts at"
            value={midiStart}
            options={[
              { value: "audio", label: "Song start" },
              { value: "bar", label: "First note's bar" },
            ]}
            onChange={setMidiStart}
          />
        </div>
      </Section>

      <Section title="Download">
        <div className="flex gap-2">
          <FormatButton
            title="MIDI"
            extension=".mid"
            busy={busy === "midi"}
            disabled={anyBusy || noneOn}
            onClick={() => run("midi", async () => saveBlob(await midi(), `${stem}.mid`))}
          />
          <FormatButton
            title="MusicXML"
            extension=".musicxml"
            busy={busy === "xml"}
            disabled={anyBusy || noneOn}
            onClick={() =>
              run("xml", async () => saveBlob(await api.scoreMusicXml(scoreBody()), `${stem}.musicxml`))
            }
          />
          <FormatButton
            title="Audio"
            extension=".wav"
            busy={busy === "wav"}
            disabled={anyBusy || noneOn}
            onClick={() => run("wav", async () => saveBlob(await renderAudio(await midi()), `${stem}.wav`))}
          />
        </div>

        <div className="rounded-control border border-line p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-content">
                <FileText size={14} className="text-muted" />
                Sheet music
              </p>
              <p className="text-xs text-muted">Full score, each instrument, and tablature.</p>
            </div>
            <Select
              label="Page size"
              hideLabel
              className="w-24"
              value={page}
              options={[
                { value: "a4", label: "A4" },
                { value: "letter", label: "Letter" },
              ]}
              onChange={(v) => {
                setPage(v);
                setSheets(null);
              }}
            />
          </div>
          <Button
            className="mt-3 w-full"
            disabled={anyBusy || noneOn}
            onClick={() =>
              run("pdf", async () => {
                const zip = await api.scorePdf(scoreBody());
                archive.current = zip;
                const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
                setSheets(
                  Object.entries(files)
                    .filter(([name]) => name.endsWith(".pdf"))
                    .map(([name, bytes]) => ({ name, bytes: bytes as Uint8Array<ArrayBuffer> }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                );
              })
            }
          >
            {busy === "pdf" ? (
              <>
                <LoaderCircle size={14} className="animate-spin" />
                Preparing. Long songs take a minute.
              </>
            ) : (
              <>
                <Music4 size={14} />
                Prepare PDFs
              </>
            )}
          </Button>

          {sheets && (
            <ul className="mt-3 flex flex-col">
              {sheets.map((file) => (
                <li key={file.name}>
                  <button
                    type="button"
                    onClick={() =>
                      saveBlob(new Blob([file.bytes], { type: "application/pdf" }), `${stem} - ${file.name}`)
                    }
                    className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] text-content capitalize hover:bg-raised"
                  >
                    <FileMusic size={14} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{fileLabel(file.name)}</span>
                    <Download size={14} className="shrink-0 text-muted" />
                  </button>
                </li>
              ))}
              <li>
                <Button
                  variant="quiet"
                  className="mt-1 w-full"
                  onClick={() => archive.current && saveBlob(archive.current, `${stem} sheet music.zip`)}
                >
                  <Download size={14} />
                  Download all
                </Button>
              </li>
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </Section>
    </SidePanel>
  );
}
