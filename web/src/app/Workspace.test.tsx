import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workspace } from "./Workspace.tsx";

const Harness = () => {
  const [open, setOpen] = useState(true);
  const [selection, setSelection] = useState("agent:1");
  return (
    <Workspace
      navigation={<span>Navigation</span>}
      inspector={
        <button
          type="button"
          onClick={() => {
            setSelection("");
            setOpen(false);
          }}
        >
          Close Inspector
        </button>
      }
      inspectorOpen={open}
      onInspectorOpenChange={setOpen}
      revealInspector={selection || undefined}
    >
      {() => <span>Canvas</span>}
    </Workspace>
  );
};

describe("Workspace", () => {
  let browser: Window;
  let root: Root;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    browser = new Window();
    browser.innerWidth = 600;
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await browser.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    saved.clear();
  });

  test("dismisses and reopens the narrow Inspector through one controlled state", async () => {
    await act(async () => root.render(<Harness />));
    expect(document.querySelector(".workspace__inspector")).not.toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".workspace__inspector button")?.click();
    });
    expect(document.querySelector(".workspace__inspector")).toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Toggle inspector"]')?.click();
    });
    expect(document.querySelector(".workspace__inspector")).not.toBeNull();
  });
});
