import { createRef } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) };
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { value: () => rect });
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [] });
});

const mocks = vi.hoisted(() => ({ writeText: vi.fn() }));

vi.mock("../../../ipc/transport", () => ({ uploadDocImage: vi.fn() }));
vi.mock("../../../platform", () => ({
  env: { isTauri: false },
  platform: { clipboard: { writeText: mocks.writeText } },
}));
vi.mock("../../../terminal/imageInput", () => ({
  extOf: () => "png",
  imageFromNativeClipboard: vi.fn(),
  imagesFromClipboard: () => [],
}));

import { SourceEditor, type SourceHandle } from "./SourceEditor";

function editor(path = "/tmp/reference.ts", revealRequest?: { line: number; id: number }) {
  const ref = createRef<SourceHandle>();
  const view = render(
    <SourceEditor
      ref={ref}
      defaultValue={"first\nsecond\nthird"}
      path={path}
      kind="code"
      revealRequest={revealRequest}
      onEdited={() => {}}
    />,
  );
  return { ref, view };
}

beforeEach(() => {
  mocks.writeText.mockReset();
  mocks.writeText.mockResolvedValue(undefined);
});

it("reveals requested lines on mount and subsequent requests, clamping to the document", async () => {
  const { ref, view } = editor("/tmp/reference.ts", { line: 2, id: 1 });
  await waitFor(() => expect(ref.current?.getText()).toBe("first\nsecond\nthird"));

  act(() => ref.current?.copyReference());
  expect(mocks.writeText).toHaveBeenLastCalledWith("/tmp/reference.ts:2", { reportFailure: true });

  act(() => ref.current?.revealLine(1));
  view.rerender(
    <SourceEditor
      ref={ref}
      defaultValue={"first\nsecond\nthird"}
      path="/tmp/reference.ts"
      kind="code"
      revealRequest={{ line: 2, id: 2 }}
      onEdited={() => {}}
    />,
  );
  act(() => ref.current?.copyReference());
  expect(mocks.writeText).toHaveBeenLastCalledWith("/tmp/reference.ts:2", { reportFailure: true });

  view.rerender(
    <SourceEditor
      ref={ref}
      defaultValue={"first\nsecond\nthird"}
      path="/tmp/reference.ts"
      kind="code"
      revealRequest={{ line: 99, id: 3 }}
      onEdited={() => {}}
    />,
  );
  act(() => ref.current?.copyReference());
  expect(mocks.writeText).toHaveBeenLastCalledWith("/tmp/reference.ts:3", { reportFailure: true });
});

it("copies the current line with the editor shortcut", async () => {
  const { ref, view } = editor();
  await waitFor(() => expect(ref.current?.getText()).toBe("first\nsecond\nthird"));
  act(() => ref.current?.revealLine(2));
  const content = view.container.querySelector(".cm-content");
  expect(content).not.toBeNull();

  fireEvent.keyDown(content!, {
    key: "c",
    code: "KeyC",
    metaKey: false,
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  });
  expect(mocks.writeText).toHaveBeenCalledWith("/tmp/reference.ts:2", { reportFailure: true });
});

it("does not copy a reference for an unsaved draft without a path", async () => {
  const { ref, view } = editor("");
  await waitFor(() => expect(ref.current?.getText()).toBe("first\nsecond\nthird"));
  const content = view.container.querySelector(".cm-content");

  fireEvent.keyDown(content!, {
    key: "c",
    code: "KeyC",
    metaKey: false,
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  });
  act(() => ref.current?.copyReference());
  expect(mocks.writeText).not.toHaveBeenCalled();
});
