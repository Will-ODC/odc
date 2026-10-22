import { useEffect, useRef, useState } from "react";
import "./PostedBanner.css";

/**
 * One line at the top of a question someone has just posted: it is live, and
 * here is its link to share.
 *
 * "Copy link" writes the address to the clipboard. Where there is no
 * clipboard (an older browser, or a page the browser does not trust with
 * it), the address appears in a read-only field, selected, for the person to
 * copy themselves.
 */
export function PostedBanner({
  url,
  onDismiss,
}: {
  /** The question's absolute address. */
  url: string;
  onDismiss: () => void;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (copy === "manual") field.current?.select();
  }, [copy]);

  function copyLink() {
    // Emptied first, so a second "Copied" is a change the status reads out.
    setCopy("idle");
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      setCopy("manual");
      return;
    }
    clipboard.writeText(url).then(
      () => setCopy("copied"),
      () => setCopy("manual"),
    );
  }

  return (
    <div className="posted">
      <p className="posted__line">
        Your question is live ·{" "}
        <button type="button" className="posted__copy" onClick={copyLink}>
          Copy link
        </button>
      </p>
      <button
        type="button"
        className="posted__dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
      {copy === "manual" ? (
        <input
          ref={field}
          className="posted__field"
          readOnly
          value={url}
          aria-label="Link to your question"
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      <p className="posted__status" role="status">
        {copy === "copied"
          ? "Copied"
          : copy === "manual"
            ? "Copy the selected link."
            : ""}
      </p>
    </div>
  );
}
