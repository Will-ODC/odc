import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// jsdom cannot pan, scroll or animate; retain the rules that do so (#554).
const css = readFileSync(
  new URL("../src/screens/Conversation.css", import.meta.url),
  "utf8",
);

it("lets the browser keep vertical scrolling and zoom on the swipe area", () => {
  expect(css).toMatch(
    /\.conversation__question--swipe,[^{]*\{\s*touch-action: pan-y pinch-zoom;/,
  );
});

it("slides the next question in briefly, and not at all under reduced motion", () => {
  expect(css).toMatch(
    /\.conversation__scroll > \.conversation__column \{\s*animation: question-arrive var\(--motion-quick\) ease-out;/,
  );
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.conversation__scroll > \.conversation__column \{\s*animation: none;/,
  );
});
