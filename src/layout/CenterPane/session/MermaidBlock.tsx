//! Conversation diagrams reuse the document renderer without loading Mermaid for ordinary messages.

import { useEffect, useState } from "react";
import { useT } from "../../../i18n";
import { highlight } from "../../RightPanel/highlight";
import type { DiagramTheme, MermaidResult } from "../doc/mermaid";
import { CodeBlockHeader } from "./CodeBlockHeader";
import { codeBlockCopyAttributes, copyAttributes } from "./selectionCopy";

let renderer: Promise<typeof import("../doc/mermaid")> | undefined;
function loadRenderer() {
  return renderer ??= import("../doc/mermaid").catch(error => {
    renderer = undefined;
    throw error;
  });
}

function currentTheme(): DiagramTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function MermaidBlock({ code, lang, complete }: { code: string; lang?: string; complete: boolean }) {
  const t = useT();
  const [theme, setTheme] = useState(currentTheme);
  const [rendered, setRendered] = useState<(MermaidResult & { code: string; theme: DiagramTheme }) | null>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!complete || !code.trim()) return;
    let active = true;
    void loadRenderer()
      .then(renderer => renderer.renderMermaid(theme, code))
      .then(result => { if (active) setRendered({ ...result, code, theme }); })
      .catch(error => { if (active) setRendered({ code, theme, error: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [code, complete, theme]);

  // A late result from an earlier source or theme must never draw over the current answer.
  const result = complete && rendered?.code === code && rendered.theme === theme ? rendered : null;
  const source = <pre {...copyAttributes.code}>{highlight(code)}</pre>;
  return <div className="sv-code sv-mermaid">
    <CodeBlockHeader code={code} lang={lang} />
    {result?.svg ? <>
      <div className="sv-mermaid-diagram" {...copyAttributes.ignore} dangerouslySetInnerHTML={{ __html: result.svg }} />
      <details className="sv-mermaid-source" {...codeBlockCopyAttributes(lang)}>
        <summary {...copyAttributes.ignore}>{t("doc.source")}</summary>
        {source}
      </details>
    </> : <>
      {result?.error && <div className="sv-mermaid-error" role="status" {...copyAttributes.ignore}>{t("doc.diagramError")}: {result.error}</div>}
      <div {...codeBlockCopyAttributes(lang)}>{source}</div>
    </>}
  </div>;
}
