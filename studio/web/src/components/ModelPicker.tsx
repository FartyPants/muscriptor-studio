import type { ModelInfo, ModelSize } from "../api";
import { Segmented } from "./ui";

const LABELS: Record<ModelSize, string> = {
  small: "Small",
  medium: "Medium (recommended)",
  large: "Large",
};
const HINTS: Record<ModelSize, string> = {
  small: "Fastest, and the practical choice without a GPU. Less accurate.",
  medium: "Fast, and accurate when the instruments are listed.",
  large: "Slower, and needs more GPU memory. Best on short songs.",
};

/** Small, Medium or Large, whichever are on disk. The server loads the choice when work starts. */
export function ModelPicker(props: {
  models: ModelInfo[];
  value: ModelSize;
  onChange: (size: ModelSize) => void;
}) {
  const { models, value, onChange } = props;
  const options = (["small", "medium", "large"] as const)
    .filter((size) => models.find((m) => m.size === size)?.available)
    .map((size) => ({ value: size, label: LABELS[size] }));
  return (
    <div>
      <Segmented label="Model" value={value} options={options} onChange={onChange} />
      <p className="mt-1.5 text-xs text-muted">{HINTS[value]}</p>
    </div>
  );
}
