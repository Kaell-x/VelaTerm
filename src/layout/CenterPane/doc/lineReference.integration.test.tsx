import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { platform } from "../../../platform";
import { useTermStore } from "../../../store/termStore";
import { SessionLink } from "../session/links";
import { DocView } from "./DocView";

const { readTextFile, statFile, writeTextFile } = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  statFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../../../ipc/info", () => ({
  readTextFile,
  statFile,
  writeTextFile,
  FILE_BEING_WRITTEN: "FILE_BEING_WRITTEN",
  loadFileBlob: vi.fn(),
}));
vi.mock("../../../ipc/commands", () => ({
  createWorktree: vi.fn(),
  getSessionCwd: vi.fn().mockResolvedValue(null),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  listShells: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../ipc/tree", () => ({
  listTree: vi.fn().mockResolvedValue({ projects: [], groups: [], sessions: [] }),
}));
vi.mock("../../../notify", () => ({
  notify: vi.fn(),
  getNotifyPermission: vi.fn().mockResolvedValue("granted"),
  requestNotifyPermission: vi.fn().mockResolvedValue("granted"),
  getEffectiveNotifyPermission: vi.fn().mockResolvedValue("granted"),
  requestEffectiveNotifyPermission: vi.fn().mockResolvedValue("granted"),
}));

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) };
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { value: () => rect });
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [] });
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  readTextFile.mockResolvedValue({ content: "first\nsecond\nthird", mtimeMs: 1 });
  statFile.mockResolvedValue({ size: 19, mtimeMs: 1 });
  writeTextFile.mockResolvedValue({ conflict: false, mtimeMs: 2 });
  useTermStore.setState({
    openTabs: [],
    activeTabId: null,
    activeSessionId: null,
    focusedPaneId: null,
    docTabs: {},
  });
});

it("opens an agent citation at its line and copies that reference by keyboard and context menu", async () => {
  const copy = vi.spyOn(platform.clipboard, "writeText").mockResolvedValue(undefined);
  render(<SessionLink href="/tmp/line-reference.ts:2">implementation</SessionLink>);
  fireEvent.click(screen.getByRole("link", { name: "implementation" }));

  const tab = Object.values(useTermStore.getState().docTabs)[0];
  expect(tab).toMatchObject({
    path: "/tmp/line-reference.ts",
    mode: "source",
    revealRequest: { line: 2, id: 1 },
  });
  const view = render(<DocView tab={tab} hidden={false} />);
  await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
  const content = view.container.querySelector(".cm-content")!;

  fireEvent.keyDown(content, {
    key: "c",
    code: "KeyC",
    metaKey: false,
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  });
  expect(copy).toHaveBeenCalledWith("/tmp/line-reference.ts:2", { reportFailure: true });

  copy.mockClear();
  fireEvent.contextMenu(content);
  fireEvent.click(await screen.findByText("Copy Reference"));
  expect(copy).toHaveBeenCalledWith("/tmp/line-reference.ts:2", { reportFailure: true });
});
