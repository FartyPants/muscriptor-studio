import { useEffect, useState } from "react";
import { api, type ModelSize, type ModelsState, type ProjectDoc } from "../api";
import { formatClock } from "../progress";
import { InstrumentChooser } from "./InstrumentChooser";
import { availableModel, ModelPicker } from "./ModelPicker";
import { Button, Modal } from "./ui";

export type RetranscribeRequest = { hints: string[]; model: ModelSize };

export function RetranscribeDialog(props: {
  doc: ProjectDoc;
  /** Null means the entire audio. */
  range: { start: number; end: number } | null;
  noteCount: number;
  onCancel: () => void;
  onStart: (request: RetranscribeRequest) => void;
}) {
  const { doc, range, noteCount, onCancel, onStart } = props;
  const [models, setModels] = useState<ModelsState | null>(null);
  const [size, setSize] = useState<ModelSize>(doc.model ?? "medium");
  const [hints, setHints] = useState<string[]>(doc.hints ?? []);

  useEffect(() => {
    api.models().then((state) => {
      setModels(state);
      setSize((wanted) => availableModel(state.models, wanted) ?? wanted);
    }, () => {});
  }, []);

  const scope = range
    ? `from ${formatClock(range.start)} to ${formatClock(range.end)}`
    : "for the whole song";
  return (
    <Modal
      title={range ? "Re-transcribe selected range" : "Re-transcribe entire audio"}
      subtitle={`Replaces ${noteCount === 1 ? "the 1 note" : `the ${noteCount.toLocaleString()} notes`} ${scope}. Undo brings them back.`}
      onClose={onCancel}
    >
      {models && (
        <div className="mb-4">
          <ModelPicker models={models.models} value={size} onChange={setSize} />
        </div>
      )}
      <InstrumentChooser
        doc={{ ...doc, model: size }}
        onHints={setHints}
        renderActions={({ busy }) => (
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => onStart({ hints, model: size })}
            >
              {hints.length ? `Re-transcribe with ${hints.length} instrument${hints.length === 1 ? "" : "s"}` : "Re-transcribe, model decides"}
            </Button>
          </div>
        )}
      />
    </Modal>
  );
}
