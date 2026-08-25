/**
 * The four states every view owes, as one shape.
 *
 * Written once so that four screens cannot grow four different `isLoading &&`
 * ladders. A hook returns this; `<ViewState>` renders the three states that
 * are not content, and the screen only ever writes the content branch.
 */
export type ViewData<T> =
  | { status: "loading" }
  /** Nothing to show, and a sentence saying what happens instead. Never blank. */
  | { status: "empty"; message: string }
  /** One plain sentence: what happened, and what to do about it. */
  | { status: "error"; message: string }
  | { status: "ready"; value: T };
