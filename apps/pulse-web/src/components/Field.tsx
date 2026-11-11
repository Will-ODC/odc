import type { ReactNode } from "react";
import "./Field.css";

/** A labelled control with an optional hint and inline problem. */
export function Field({
  id,
  label,
  hint,
  problem,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  problem: string | undefined;
  className?: string;
  children: (described: { "aria-describedby"?: string }) => ReactNode;
}) {
  const ids = [
    ...(hint ? [`${id}-hint`] : []),
    ...(problem ? [`${id}-problem`] : []),
  ];
  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children(ids.length ? { "aria-describedby": ids.join(" ") } : {})}
      {problem ? (
        <p className="field__problem" id={`${id}-problem`} role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
