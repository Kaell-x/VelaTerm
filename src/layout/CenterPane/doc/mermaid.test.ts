import { beforeEach, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

import mermaid from "mermaid";
import { cachedMermaidSvg, renderMermaid } from "./mermaid";

beforeEach(() => {
  vi.mocked(mermaid.initialize).mockReset();
  vi.mocked(mermaid.render).mockReset();
});

it("serializes diagrams that arrive while another render is queued", async () => {
  const finishes: (() => void)[] = [];
  const started: string[] = [];
  let active = 0;
  let maximum = 0;
  vi.mocked(mermaid.render).mockImplementation((_id, source) => new Promise(resolve => {
    active += 1;
    maximum = Math.max(maximum, active);
    started.push(source);
    finishes.push(() => { active -= 1; resolve({ svg: "<svg><text>ok</text></svg>", diagramType: "flowchart" }); });
  }));
  const first = renderMermaid("light", "queue-first");
  const second = renderMermaid("dark", "queue-second");
  await vi.waitFor(() => expect(started).toEqual(["queue-first"]));
  finishes[0]();
  await first;
  await vi.waitFor(() => expect(started).toEqual(["queue-first", "queue-second"]));
  const third = renderMermaid("light", "queue-third");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(started).toEqual(["queue-first", "queue-second"]);
  finishes[1]();
  await second;
  await vi.waitFor(() => expect(started).toHaveLength(3));
  finishes[2]();
  await third;
  expect(maximum).toBe(1);
});

it("sanitizes SVG output, caches it, and retains strict SVG text labels", async () => {
  vi.mocked(mermaid.render).mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text onclick="alert(1)">示例文本</text><foreignObject><div>unsafe</div></foreignObject></svg>', diagramType: "flowchart" });
  const result = await renderMermaid("dark", "sanitize-diagram");
  expect(result.svg).toContain("示例文本");
  expect(result.svg).not.toMatch(/script|onclick|foreignObject/);
  expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", htmlLabels: false, theme: "dark" }));
  expect(cachedMermaidSvg("dark", "sanitize-diagram")).toBe(result.svg);
  await renderMermaid("dark", "sanitize-diagram");
  expect(mermaid.render).toHaveBeenCalledTimes(1);
});

it("recovers after initialization and syntax errors without blocking later diagrams", async () => {
  vi.mocked(mermaid.initialize).mockImplementationOnce(() => { throw new Error("Initialization failed"); });
  expect((await renderMermaid("light", "init-error")).error).toBe("Initialization failed");
  vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse failed"));
  expect((await renderMermaid("light", "parse-error")).error).toBe("Parse failed");
  vi.mocked(mermaid.render).mockResolvedValue({ svg: "<svg><text>Recovered</text></svg>", diagramType: "flowchart" });
  expect((await renderMermaid("light", "recovered-diagram")).svg).toContain("Recovered");
});

it("accepts a generic Chinese flowchart with branches using the real Mermaid parser", async () => {
  const actual = await vi.importActual<typeof import("mermaid")>("mermaid");
  const source = "flowchart TD\n  A[开始 Start] --> B[读取示例数据]\n  B --> C[准备输入: 包含多个元素]\n  C --> D[构建示例配置]\n  D --> E{是否启用扩展模式}\n  E -->|是| F[转换数据 Map, 补充示例参数]\n  E -->|否| G[使用默认参数]\n  F --> H[运行示例步骤]\n  G --> H\n  H --> I[输出结果或错误]";
  expect((await actual.default.parse(source))?.diagramType).toBe("flowchart-v2");
});
