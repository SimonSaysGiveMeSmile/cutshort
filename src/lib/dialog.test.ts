import { describe, it, expect, vi } from "vitest";
import { wireDialog } from "./dialog";

// wireDialog is the pure DOM core of the dialog hook — Escape-to-close + focus
// management — so it's testable in jsdom without rendering a component.

describe("wireDialog", () => {
  it("closes on Escape and ignores other keys", () => {
    const onClose = vi.fn();
    const node = document.createElement("div");
    node.tabIndex = -1;
    document.body.appendChild(node);
    const cleanup = wireDialog(node, onClose);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onClose).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    node.remove();
  });

  it("moves focus into the dialog and restores it to the trigger on cleanup", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const node = document.createElement("div");
    node.tabIndex = -1;
    document.body.appendChild(node);
    const cleanup = wireDialog(node, () => {});
    expect(document.activeElement).toBe(node); // focus moved into the dialog

    cleanup();
    expect(document.activeElement).toBe(trigger); // focus restored

    trigger.remove();
    node.remove();
  });

  it("stops closing after cleanup runs (listener removed)", () => {
    const onClose = vi.fn();
    const node = document.createElement("div");
    node.tabIndex = -1;
    document.body.appendChild(node);
    const cleanup = wireDialog(node, onClose);
    cleanup();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
    node.remove();
  });

  // Without a trap, Tab/Shift+Tab walks focus onto the deck keys behind the scrim,
  // where a keyboard user can fire a real keystroke through a supposedly-modal sheet.
  function makeDialog(n: number) {
    const node = document.createElement("div");
    node.tabIndex = -1;
    const buttons = Array.from({ length: n }, () => document.createElement("button"));
    node.append(...buttons);
    document.body.appendChild(node);
    return { node, buttons };
  }

  it("wraps Tab from the last focusable back to the first", () => {
    const { node, buttons } = makeDialog(3);
    const cleanup = wireDialog(node, () => {});
    buttons[2].focus();
    const e = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    document.dispatchEvent(e);
    expect(document.activeElement).toBe(buttons[0]);
    expect(e.defaultPrevented).toBe(true);
    cleanup();
    node.remove();
  });

  it("wraps Shift+Tab from the first focusable to the last", () => {
    const { node, buttons } = makeDialog(3);
    const cleanup = wireDialog(node, () => {});
    buttons[0].focus();
    const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
    document.dispatchEvent(e);
    expect(document.activeElement).toBe(buttons[2]);
    expect(e.defaultPrevented).toBe(true);
    cleanup();
    node.remove();
  });

  it("leaves Tab alone in the middle of the dialog (browser handles it)", () => {
    const { node, buttons } = makeDialog(3);
    const cleanup = wireDialog(node, () => {});
    buttons[0].focus(); // first, but not last → forward Tab is not our concern
    const e = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    cleanup();
    node.remove();
  });

  it("does not hijack Tab when focus is outside the dialog", () => {
    const { node } = makeDialog(2);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const cleanup = wireDialog(node, () => {});
    outside.focus();
    const e = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    cleanup();
    outside.remove();
    node.remove();
  });
});
