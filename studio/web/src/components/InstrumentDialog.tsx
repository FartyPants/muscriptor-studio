import type { ProjectDoc } from "../api";
import { InstrumentChooser } from "./InstrumentChooser";
import { Button, Modal } from "./ui";

/** The step before a first transcription. */
export function InstrumentDialog(props: {
  doc: ProjectDoc;
  onHints: (hints: string[]) => void;
  onStart: (hints: string[]) => void;
}) {
  const { doc, onHints, onStart } = props;
  return (
    <Modal
      title="Which instruments play in this song?"
      subtitle="Transcription listens only for the instruments you list. Not sure? Detect them, or let the model decide."
      closeButtonOnly
      closeLabel="Back to projects"
      onClose={() => {
        window.location.hash = "#/new";
      }}
    >
      <InstrumentChooser
        doc={doc}
        onHints={onHints}
        renderActions={({ selected, busy }) => (
          <div className="flex justify-end gap-2">
            <Button
              variant={selected.length ? "secondary" : "primary"}
              disabled={busy}
              onClick={() => onStart([])}
            >
              Let the model decide
            </Button>
            {selected.length > 0 && (
              <Button variant="primary" disabled={busy} onClick={() => onStart(selected)}>
                Transcribe with {selected.length} instrument{selected.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        )}
      />
    </Modal>
  );
}
