import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function parseNumber(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

export function NumberField({
  value,
  onChange,
  label,
  prefix,
  suffix,
  min,
  max,
  step,
  testId,
  useCommas,
  commitOnBlur,
  hint,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  useCommas?: boolean;
  /** Apply the typed number when the field loses focus, instead of on each keystroke. */
  commitOnBlur?: boolean;
  hint?: string;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : useCommas ? (value === 0 ? "" : value.toLocaleString("en-US")) : value === 0 ? "" : String(value);

  return (
    <div className="space-y-1.5">
      {label ? <Label className="text-xs text-muted-foreground">{label}</Label> : null}
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>
        ) : null}
        <Input
          type="text"
          inputMode={step !== undefined && step < 1 ? "decimal" : "numeric"}
          value={shown}
          placeholder="0"
          min={min}
          max={max}
          step={step || 1}
          data-testid={testId}
          className={`${prefix ? "pl-7" : ""} ${suffix ? "pr-7" : ""}`}
          onDoubleClick={(event) => event.currentTarget.select()}
          onWheel={(event) => event.currentTarget.blur()}
          onFocus={() => {
            setFocused(true);
            setText(value === 0 ? "" : String(value));
          }}
          onBlur={() => {
            setFocused(false);
            if (text === "" || Number.isNaN(parseNumber(text))) {
              if (!commitOnBlur) onChange(0);
              return;
            }
            if (!commitOnBlur) return;
            let next = Math.round(parseNumber(text));
            if (min !== undefined) next = Math.max(min, next);
            if (max !== undefined) next = Math.min(max, next);
            if (next !== value) onChange(next);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (commitOnBlur) return;
            if (useCommas) onChange(parseNumber(next));
            else if (next === "") onChange(0);
            else if (!Number.isNaN(Number(next))) onChange(Number(next));
          }}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span>
        ) : null}
      </div>
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
