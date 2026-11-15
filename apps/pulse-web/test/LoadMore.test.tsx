// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { LoadMore } from "../src/components/LoadMore.js";
import type { PagedListMore } from "../src/hooks/use-paged-list.js";

afterEach(cleanup);

/*
 * A list whose next page the test hands in: `next()` settles the read with
 * that many new rows (a page can be empty and still have more), or fails it.
 */
let settle!: (outcome: number | "fail") => void;
function List({ start = 2 }: { start?: number }) {
  const [rows, setRows] = useState(start);
  const [more, setMore] = useState<PagedListMore>({ status: "idle" });
  const list = useRef<HTMLUListElement>(null);
  settle = (outcome) => {
    if (outcome === "fail")
      setMore({ status: "error", message: "We couldn't load more." });
    else {
      setRows((count) => count + outcome);
      setMore({ status: "idle" });
    }
  };
  return (
    <>
      <ul ref={list}>
        {Array.from({ length: rows }, (_, at) => (
          <li key={at}>
            <a href={`#row-${at + 1}`}>Row {at + 1}</a>
          </li>
        ))}
      </ul>
      <LoadMore
        more={more}
        hasMore
        itemCount={rows}
        listRef={list}
        onLoadMore={() => setMore({ status: "loading" })}
      />
    </>
  );
}

const button = () => screen.getByRole("button");

it("keeps focus on Load more while it loads, marked rather than disabled (#605)", async () => {
  const user = userEvent.setup();
  render(<List />);
  button().focus();
  await user.keyboard("{Enter}");
  expect(button().textContent).toBe("Loading more…");
  expect(button().getAttribute("aria-disabled")).toBe("true");
  expect(button().hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(button());
});

it("asks for one page at a time, however often it is pressed while loading", async () => {
  const user = userEvent.setup();
  let asked = 0;
  function Counting() {
    const [more, setMore] = useState<PagedListMore>({ status: "idle" });
    const list = useRef<HTMLUListElement>(null);
    return (
      <>
        <ul ref={list} />
        <LoadMore
          more={more}
          hasMore
          itemCount={0}
          listRef={list}
          onLoadMore={() => {
            asked += 1;
            setMore({ status: "loading" });
          }}
        />
      </>
    );
  }
  render(<Counting />);
  await user.click(button());
  await user.click(button());
  await user.keyboard("{Enter}");
  expect(asked).toBe(1);
});

it("leaves focus on the button, now Try again, when the page fails (#605)", async () => {
  const user = userEvent.setup();
  render(<List />);
  button().focus();
  await user.keyboard("{Enter}");
  act(() => settle("fail"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "We couldn't load more.",
  );
  expect(button().textContent).toBe("Try loading more again");
  expect(document.activeElement).toBe(button());
});

it("moves focus to the first new row once the page arrives", async () => {
  const user = userEvent.setup();
  render(<List />);
  button().focus();
  await user.keyboard("{Enter}");
  act(() => settle(2));
  await screen.findByRole("link", { name: "Row 4" });
  expect(document.activeElement).toBe(
    screen.getByRole("link", { name: "Row 3" }),
  );
});

it("keeps focus on the button when the page adds no rows but more remain (#605)", async () => {
  const user = userEvent.setup();
  render(<List />);
  button().focus();
  await user.keyboard("{Enter}");
  act(() => settle(0));
  await screen.findByText("Load more");
  expect(document.activeElement).toBe(button());
  // Asked again, the next new row still takes focus.
  await user.keyboard("{Enter}");
  act(() => settle(1));
  await screen.findByRole("link", { name: "Row 3" });
  expect(document.activeElement).toBe(
    screen.getByRole("link", { name: "Row 3" }),
  );
});
