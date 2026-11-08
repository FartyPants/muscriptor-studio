import clsx from "clsx";
import { useId } from "react";
import type { ModelInfo, ModelSize } from "../api";

type Size = { name: string; params: string; use: string; hint: string; recommended?: boolean };

// Parameter counts from the weight files: 103M, 307M and 1.37B.
const SIZES: Record<ModelSize, Size> = {
  small: {
    name: "Small",
    params: "100M parameters",
    use: "For CPU",
    hint: "Fastest, and the practical choice without a GPU. Less accurate.",
  },
  medium: {
    name: "Medium",
    params: "300M parameters",
    use: "For CPU or GPU",
    recommended: true,
    hint: "Fast, and accurate when the instruments are listed.",
  },
  large: {
    name: "Large",
    params: "1.4B parameters",
    use: "For GPU",
    hint: "Slower, and needs more GPU memory. Best on short songs.",
  },
};

/** Small, Medium or Large, whichever are on disk. The server loads the choice when work starts. */
export function ModelPicker(props: {
  models: ModelInfo[];
  value: ModelSize;
  onChange: (size: ModelSize) => void;
}) {
  const { models, value, onChange } = props;
  const heading = useId();
  const options = (["small", "medium", "large"] as const).filter(
    (size) => models.find((m) => m.size === size)?.available,
  );
  return (
    <div>
      <p id={heading} className="mb-1.5 text-[13px] font-medium text-content">
        Model
      </p>
      <div role="radiogroup" aria-labelledby={heading} className="flex gap-1.5">
        {options.map((size) => {
          const chosen = size === value;
          const info = SIZES[size];
          return (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => onChange(size)}
              className={clsx(
                "min-w-0 flex-1 rounded-control border px-3 py-2 text-left transition-colors",
                chosen
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-ink hover:border-line-strong",
              )}
            >
              <span
                className={clsx(
                  "block text-[13px] font-medium",
                  chosen ? "text-content" : "text-muted",
                )}
              >
                {info.name}
                {info.recommended && (
                  <span className="block text-xs font-normal text-accent sm:ml-1.5 sm:inline">
                    Recommended
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted">{info.params}</span>
              <span className="block text-xs text-muted">{info.use}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">{SIZES[value].hint}</p>
    </div>
  );
}
