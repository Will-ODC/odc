// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it } from "vitest";
import { App } from "../src/App.js";
import { graph, poll, results, stubApi } from "./stub-api.js";

afterEach(cleanup);
beforeAll(() => import("../src/components/BarChart.js"));

it("Next updates the address; Back and Forward restore the question and saved answer (#502)", async () => {
  const first = poll({ next: [null, "parks"] });
  const parks = poll({ id: "parks", question: "More parks?" });
  history.replaceState(null, "", "/?poll=ads-free");
  render(<App api={stubApi({ poll: graph([first, parks]) })} />);
  const user = userEvent.setup();
  const main = () => within(screen.getByRole("main"));
  await main().findByRole("heading", { name: first.question, level: 1 });
  await user.click(main().getByRole("radio", { name: "Yes" }));
  await user.click(main().getByRole("button", { name: "Submit" }));
  await user.click(await main().findByRole("button", { name: "Next" }));
  await main().findByRole("heading", { name: parks.question, level: 1 });
  expect(location.pathname + location.search).toBe("/?poll=parks");
  const length = history.length;
  const rail = within(screen.getByRole("navigation", { name: "My votes" }));
  await user.click(rail.getByRole("link", { name: first.question }));
  await main().findByRole("heading", { name: first.question, level: 1 });
  expect(location.search).toBe("?poll=ads-free");
  await user.click(rail.getByRole("link", { name: first.question }));
  expect(history.length).toBe(length + 1);
  act(() => history.back());
  await waitFor(() => expect(location.search).toBe("?poll=parks"));
  await main().findByRole("heading", { name: parks.question, level: 1 });
  act(() => history.back());
  await waitFor(() => expect(location.search).toBe("?poll=ads-free"));
  await main().findByRole("heading", { name: first.question, level: 1 });
  expect(main().queryByRole("button", { name: "Submit" })).toBeNull();
  expect(main().getByRole("button", { name: "Change my answer" })).toBeTruthy();
  act(() => history.forward());
  await waitFor(() => expect(location.search).toBe("?poll=parks"));
  await main().findByRole("heading", { name: parks.question, level: 1 });
});

it("Next to the current question leaves history unchanged (#502)", async () => {
  const first = poll({ next: [null, "ads-free"] });
  history.replaceState(null, "", "/?poll=ads-free");
  render(
    <App
      api={stubApi({
        poll: graph([first]),
        myBallot: async () => [1],
        results: async () => results(),
      })}
    />,
  );
  const main = within(screen.getByRole("main"));
  const next = await main.findByRole("button", { name: "Next" });
  const length = history.length;
  await userEvent.click(next);
  expect(location.search).toBe("?poll=ads-free");
  expect(history.length).toBe(length);
});
