import type { ReactNode } from "react";
import "./Choice.css";

/** A labelled radio option; the parent owns the selected value. */
export function Choice({
  name,
  value,
  checked,
  onPick,
  children,
}: {
  name: string;
  value?: string;
  checked: boolean;
  onPick: () => void;
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
      />
      <span>{children}</span>
    </label>
  );
}
