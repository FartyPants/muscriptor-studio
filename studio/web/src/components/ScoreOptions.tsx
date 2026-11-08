import { NO_FRETBOARD, type Fretboard, type Tuning } from "../api";
import { displayName } from "../instruments";
import { Select, Toggle } from "./ui";

const TUNINGS: { value: Tuning; label: string }[] = [
  { value: "guitar", label: "Guitar" },
  { value: "drop_d", label: "Drop D" },
  { value: "ukulele", label: "Ukulele" },
  { value: "ukulele_low_g", label: "Ukulele low G" },
];

const CAPOS = [0, 1, 2, 3, 4, 5, 6, 7].map((fret) => ({
  value: fret,
  label: fret === 0 ? "No capo" : `Capo ${fret}`,
}));

/** Which track gets tab, and the fretboard it is written for. */
export function ScoreOptions(props: {
  value: Fretboard | null | undefined;
  /** Pitched tracks in the score, most notes first. */
  tracks: string[];
  /** Tracks silenced by a mute or by another track's solo. */
  muted: string[];
  onChange: (next: Fretboard) => void;
}) {
  const { tracks, muted, onChange } = props;
  const value = { ...NO_FRETBOARD, ...props.value };
  // A chosen track stays listed while it isn't in the score, so the choice isn't lost.
  const listed = value.tab && !tracks.includes(value.tab) ? [...tracks, value.tab] : tracks;
  const trackOptions = [
    { value: "", label: "No tab" },
    ...listed.map((name) => ({
      value: name,
      label: tracks.includes(name)
        ? `Tab: ${displayName(name)}`
        : `Tab: ${displayName(name)} (${muted.includes(name) ? "muted" : "no notes"})`,
    })),
  ];
  const fretted = Boolean(value.tab) || value.diagrams;
  return (
    <div className="flex items-center gap-2">
      <Toggle pressed={value.diagrams} onClick={() => onChange({ ...value, diagrams: !value.diagrams })}>
        Diagrams
      </Toggle>
      <Select
        label="Tablature"
        hideLabel
        value={value.tab ?? ""}
        options={trackOptions}
        onChange={(tab) => onChange({ ...value, tab: tab || null })}
        className="w-48"
      />
      {fretted && (
        <>
          <Select
            label="Tuning"
            hideLabel
            value={value.tuning}
            options={TUNINGS}
            onChange={(tuning) => onChange({ ...value, tuning })}
            className="w-36"
          />
          <Select
            label="Capo"
            hideLabel
            value={value.capo}
            options={CAPOS}
            onChange={(capo) => onChange({ ...value, capo })}
            className="w-28"
          />
        </>
      )}
    </div>
  );
}
