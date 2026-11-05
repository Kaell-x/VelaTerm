import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../doc/mermaid", () => ({ renderMermaid: vi.fn() }));
vi.mock("../../../platform", () => ({ platform: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } } }));

import { platform } from "../../../platform";
import { renderMermaid } from "../doc/mermaid";
import { Markdown } from "./markdown";
import { createMessageSelectionClipboardContent } from "./selectionCopy";

const diagram = "flowchart TD\n  A[开始 Start] --> B[读取示例数据]\n  B --> C[准备输入: 包含多个元素]\n  C --> D[构建示例配置]\n  D --> E{是否启用扩展模式}\n  E -->|是| F[转换数据 Map, 补充示例参数]\n  E -->|否| G[使用默认参数]\n  F --> H[运行示例步骤]\n  G --> H\n  H --> I[输出结果或错误]";
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram preview</text></svg>';

beforeEach(() => {
  document.documentElement.dataset.theme = "light";
  vi.mocked(renderMermaid).mockReset().mockResolvedValue({ svg });
  vi.mocked(platform.clipboard.writeText).mockClear();
});
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

it("renders a Mermaid answer and copies its original source without diagram or toolbar text", async () => {
  const text = `Example diagram:\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\nDone.`;
  const { container } = render(<div className="sv-msg-body"><Markdown text={text} /></div>);
  await screen.findByText("Diagram preview");
  expect(renderMermaid).toHaveBeenCalledWith("light", diagram);
  expect(container.querySelector("details")?.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(platform.clipboard.writeText).toHaveBeenCalledWith(diagram, { reportFailure: true }));

  const body = container.firstElementChild!;
  const range = document.createRange();
  range.selectNodeContents(body);
  const selection = window.getSelection()!;
  selection.addRange(range);
  const copied = createMessageSelectionClipboardContent(selection, body);
  expect(copied?.markdown).toBe(text);
  expect(copied?.plainText).toContain(diagram);
  expect(copied?.plainText).not.toContain("Diagram preview");
  expect(copied?.plainText).not.toContain("Source");
});

it("keeps streamed source visible until the closing fence arrives", async () => {
  const view = render(<Markdown text={`\`\`\`mermaid\n${diagram}`} />);
  expect(view.container.querySelector("pre")?.textContent).toBe(diagram);
  expect(renderMermaid).not.toHaveBeenCalled();
  view.rerender(<Markdown text={`\`\`\`mermaid\n${diagram}\n\`\`\``} />);
  await screen.findByText("Diagram preview");
});

it("recognizes Mermaid fences inside lists and quotes, including tilde fences and language metadata", async () => {
  render(<Markdown text={"- Diagram:\n\n  ~~~~Mermaid title\n  flowchart LR\n    A --> B\n  ~~~~\n\n> ```mermaid\n> sequenceDiagram\n>   A->>B: hello\n> ```"} />);
  await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(2));
  expect(screen.getAllByText("Diagram preview")).toHaveLength(2);
});

it("keeps ordinary code blocks unchanged and shows invalid Mermaid as source with an error", async () => {
  const view = render(<Markdown text={'```js\nconst value = "mermaid";\n```'} />);
  expect(renderMermaid).not.toHaveBeenCalled();
  expect(view.container.querySelector("pre")?.textContent).toBe('const value = "mermaid";');
  vi.mocked(renderMermaid).mockResolvedValue({ error: "Invalid diagram" });
  view.rerender(<Markdown text={"```mermaid\ninvalid graph\n```\n\nThe rest of the reply."} />);
  await screen.findByText("Diagram error: Invalid diagram");
  expect(view.container.querySelector("pre")?.textContent).toBe("invalid graph");
  expect(screen.getByText("The rest of the reply.")).toBeTruthy();
});

it("ignores late renders for an earlier source and rerenders on a theme change", async () => {
  let finishOld!: (value: { svg: string }) => void;
  vi.mocked(renderMermaid).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const view = render(<Markdown text={"```mermaid\nflowchart LR\nA-->B\n```"} />);
  await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
  view.rerender(<Markdown text={"```mermaid\nflowchart LR\nC-->D\n```"} />);
  await screen.findByText("Diagram preview");
  await act(async () => finishOld({ svg: "<svg><text>Old diagram</text></svg>" }));
  expect(screen.queryByText("Old diagram")).toBeNull();
  await act(async () => { document.documentElement.dataset.theme = "dark"; });
  await waitFor(() => expect(renderMermaid).toHaveBeenLastCalledWith("dark", "flowchart LR\nC-->D"));
});
