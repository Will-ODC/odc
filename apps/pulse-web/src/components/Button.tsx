import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "quiet";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant: ButtonVariant;
    children: ReactNode;
    href?: string;
  }
>(function Button({ variant, className, children, href, ...props }, ref) {
  const classNames = `btn btn--${variant}${className ? ` ${className}` : ""}`;
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
