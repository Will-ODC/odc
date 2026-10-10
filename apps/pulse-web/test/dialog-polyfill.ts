/**
 * jsdom has `<dialog>` but neither `showModal()` nor `close()`, and nothing
 * that closes a dialog on Escape. This stands in for the browser, in tests
 * only - production code relies on the real thing.
 *
 * What it copies is the part the popup depends on: `showModal` sets `open`,
 * `close` clears it and fires `close`, and Escape fires a cancelable `cancel`
 * at the open dialog and then closes it unless that was prevented. It does
 * NOT make the page behind inert, and does not move focus on open or close -
 * so a test that sees focus land somewhere saw the component put it there.
 */
export function installDialog(): void {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
  document.addEventListener("keydown", onEscape);
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const open = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (!open) return;
  const cancel = new Event("cancel", { cancelable: true });
  if (open.dispatchEvent(cancel)) open.close();
}
