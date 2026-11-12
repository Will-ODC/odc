import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "quiet";

/**
 * Small is the secondary button's second size (#569): Try again and Load more
 * under a list, and the same retry in the rail and the account menu. Only the
 * secondary variant has it, so no other variant can ask for it.
 */
type Size =
  | { variant: ButtonVariant; size?: never }
  | { variant: "secondary"; size: "small" };

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> &
    Size & {
      children: ReactNode;
      href?: string;
    }
>(function Button({ variant, size, className, children, href, ...props }, ref) {
  const classNames = [
    "btn",
    `btn--${variant}`,
    size ? `btn--${size}` : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  if (href !== undefined) {
    return (
      <a className={classNames} href={href}>
        {children}
      </a>
    );
  }
  return (
    <button ref={ref} className={classNames} {...props}>
      {children}
    </button>
  );
});
