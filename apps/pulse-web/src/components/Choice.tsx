import type { ReactNode } from "react";
import "./Choice.css";

/** A labelled radio option; the parent owns the selected value. */
export function Choice({
  name,
  value,
  checked,
  onPick,
  describedBy,
  children,
}: {
  name: string;
  value?: string;
  checked: boolean;
  onPick: () => void;
  /** Id of a hint read when focus lands on this option. */
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <label className="choice">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onPick}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
      />
      <span>{children}</span>
    </label>
  );
}
