import clsx from "clsx";
import type { ModelInfo, ModelSize } from "../api";

const LABELS: Record<ModelSize, { name: string; hint: string }> = {
  large: { name: "Large", hint: "Most accurate. Slower." },
  medium: { name: "Medium", hint: "Faster. Slightly less accurate." },
};

/** Medium or Large. The server loads the choice when transcription starts. */
export function ModelPicker(props: {
  models: ModelInfo[];
  value: ModelSize;
  onChange: (size: ModelSize) => void;
  disabled?: boolean;
}) {
  const { models, value, onChange, disabled } = props;
  return (
    <div role="radiogroup" aria-label="Model" className="grid grid-cols-2 gap-2">
      {models.map((m) => {
        const label = LABELS[m.size];
        const selected = m.size === value;
        return (
          <button
            key={m.size}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || !m.available}
            onClick={() => onChange(m.size)}
            className={clsx(
              "rounded-card border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              selected ? "border-white bg-surface-2" : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-content">
              {label.name}
              {m.active && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-ok">
                  Loaded
                </span>
              )}
            </span>
            <span className="mt-1 block text-xs text-muted">
              {m.available ? label.hint : "Weights not found"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
