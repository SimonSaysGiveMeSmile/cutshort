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
});
