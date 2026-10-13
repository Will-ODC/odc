import { useEffect, useRef, type ReactNode } from "react";
import { TopBanner } from "./TopBanner.js";
import "./IntroPage.css";

export function IntroPage({
  title,
  children,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className={`welcome${compact ? " welcome--compact" : ""}`}>
      <header>
        <TopBanner signInHref="/sign-in" />
      </header>
      <main className="welcome__main">
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}
