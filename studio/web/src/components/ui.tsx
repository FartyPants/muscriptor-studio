import clsx from "clsx";
import { Check, ChevronDown, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

const CONTROL =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-control px-3 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-45";

const VARIANTS = {
  primary: "bg-content text-ink hover:bg-white",
  secondary: "border border-line-strong text-content hover:bg-raised",
  quiet: "text-muted hover:bg-raised hover:text-content",
};

export function Button({
  variant = "secondary",
  className,
  ...rest
}: { variant?: keyof typeof VARIANTS } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={clsx(CONTROL, VARIANTS[variant], className)} />;
}

/** An icon alone needs a name: `label` is the tooltip and the accessible name. */
export function IconButton({
  label,
  pressed,
  className,
  ...rest
}: { label: string; pressed?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
      className={clsx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-control transition-colors disabled:cursor-default disabled:opacity-35",
        pressed ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-content",
        className,
      )}
    />
  );
}

export function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const { label, value, options, onChange, className } = props;
  return (
    <div role="radiogroup" aria-label={label} className={clsx("flex rounded-control bg-ink p-0.5", className)}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={clsx(
            "h-7 flex-1 rounded-[5px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
            option.value === value ? "bg-raised text-content" : "text-muted hover:text-content",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const { checked, onChange, label, hint, disabled } = props;
  return (
    <label className={clsx("flex gap-2.5", disabled ? "opacity-45" : "cursor-pointer")}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={clsx(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
          checked ? "border-accent bg-accent text-ink" : "border-line-strong",
        )}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>
        <span className="block text-[13px] font-medium text-content">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Select<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const { label, value, options, onChange, disabled, hideLabel, className } = props;
  const index = options.findIndex((o) => o.value === value);
  return (
    <label className={clsx("block", className)}>
      <span className={hideLabel ? "sr-only" : "mb-1 block text-[13px] font-medium text-content"}>{label}</span>
      <span className="relative block">
        <select
          value={index}
          disabled={disabled}
          onChange={(e) => onChange(options[Number(e.target.value)].value)}
          className="h-8 w-full appearance-none rounded-control border border-line-strong bg-ink pr-7 pl-2.5 text-[13px] text-content disabled:opacity-45"
        >
          {options.map((option, i) => (
            <option key={String(option.value)} value={i}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute top-2 right-2 text-muted" />
      </span>
    </label>
  );
}

/** A panel that opens from a control, and closes on Escape or an outside click. */
export function Popover(props: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  className?: string;
}) {
  const { trigger, children, align = "left", className } = props;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPress = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // In the capture phase, so Escape closes this and not a dialog around it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onPress);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={root} className="relative">
      {trigger(open, () => setOpen((was) => !was))}
      {open && (
        <div
          className={clsx(
            "absolute top-full z-40 mt-1.5 rounded-panel border border-line-strong bg-panel shadow-pop",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** Closes on Escape, and takes focus so the keyboard is in the right place. */
function useDialog(onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Once, on opening: focusing again on a re-render would pull the cursor out of
  // whatever the user is typing in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return panel;
}

export function SidePanel(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { title, subtitle, onClose, children } = props;
  const panel = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="slide-in flex h-full w-full max-w-[440px] flex-col border-l border-line bg-panel outline-none"
      >
        <header className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-content">{title}</h2>
            {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}

export function Modal(props: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  const { title, subtitle, onClose, children } = props;
  const panel = useDialog(onClose ?? (() => {}));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-panel border border-line-strong bg-panel p-5 shadow-pop outline-none"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-content">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {onClose && (
            <IconButton label="Close" onClick={onClose}>
              <X size={16} />
            </IconButton>
          )}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
