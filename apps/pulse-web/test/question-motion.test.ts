import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// jsdom cannot pan, scroll or animate; retain the rules that do so (#554).
const css = readFileSync(
  new URL("../src/screens/Conversation.css", import.meta.url),
  "utf8",
);

it("leaves panning and zoom to the browser: the swipe sets no touch-action", () => {
  expect(css).not.toContain("touch-action");
});

it("slides a loaded question in briefly, and not at all under reduced motion", () => {
  expect(css).toMatch(
    /\.conversation__question \.conversation__scroll > \.conversation__column \{\s*animation: question-arrive var\(--motion-quick\) ease-out;/,
  );
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.conversation__question \.conversation__scroll > \.conversation__column \{\s*animation: none;/,
  );
  // "Loading…" sits in a column outside .conversation__question: no slide.
  expect(css).not.toMatch(
    /(^|\})\s*\.conversation__scroll > \.conversation__column \{\s*animation/,
  );
});
