import { useLingui } from "@lingui/react/macro";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { decodeArtifactBase64 } from "../lib/artifact-open";
import { BuiButton, LoadingState } from "./beautiful-ui/primitives";

/** Render pages without browser plugins, PDF scripts, remote viewers, or remote assets. */
export function WorkspacePdfPreview({ dataBase64 }: { dataBase64: string }) {
  const { t } = useLingui();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [width, setWidth] = useState(460);
  const [rendering, setRendering] = useState(true);
  const [pageText, setPageText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(100, Math.floor(entry.contentRect.width - 24)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let loading: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setError(null);
    setPageNumber(1);
    setRendering(true);
    void import("pdfjs-dist")
      .then(async (library) => {
        if (!active) return;
        library.GlobalWorkerOptions.workerSrc = workerUrl;
        loading = library.getDocument({
          data: decodeArtifactBase64(dataBase64),
          useSystemFonts: true,
          stopAtErrors: true,
          disableAutoFetch: true,
        });
        const document = await loading.promise;
        if (active) setPdf(document);
      })
      .catch(() => {
        if (active) {
          setError(t`This PDF could not be previewed. Download it to open it.`);
          setRendering(false);
        }
      });
    return () => {
      active = false;
      void loading?.destroy();
    };
  }, [dataBase64, t]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    const target = canvas.current;
    let active = true;
    let task: RenderTask | undefined;
    setRendering(true);
    setPageText("");
    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (!active) return;
        const initial = page.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const scale = Math.min(
          (width / initial.width) * ratio,
          4096 / Math.max(initial.width, initial.height),
        );
        const viewport = page.getViewport({ scale });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        target.style.width = `${Math.min(width, viewport.width / ratio)}px`;
        target.style.height = "auto";
        task = page.render({ canvas: target, viewport });
        await task.promise;
        const text = await page.getTextContent();
        if (active) {
          setPageText(text.items.map((item) => ("str" in item ? item.str : "")).join(" "));
          setRendering(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(t`This page could not be previewed. Download the PDF to open it.`);
          setRendering(false);
        }
      });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, pageNumber, width, t]);

  return (
    <section
      ref={container}
      aria-label={t`PDF preview`}
      className="rk-scroll min-h-[240px] flex-1 overflow-auto p-3"
    >
      {pdf ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <BuiButton
            disabled={pageNumber === 1 || rendering}
            onClick={() => {
              setError(null);
              setPageNumber((value) => value - 1);
            }}
          >{t`Previous page`}</BuiButton>
          <span className="text-xs tabular-nums">
            {pageNumber} / {pdf.numPages}
          </span>
          <BuiButton
            disabled={pageNumber === pdf.numPages || rendering}
            onClick={() => {
              setError(null);
              setPageNumber((value) => value + 1);
            }}
          >{t`Next page`}</BuiButton>
        </div>
      ) : null}
      {rendering ? <LoadingState label={t`Rendering PDF`} /> : null}
      {error ? (
        <p role="alert" className="text-[#FCA5A5]">
          {error}
        </p>
      ) : null}
      <canvas
        key={`${pageNumber}:${width}`}
        ref={canvas}
        aria-label={t`PDF page ${pageNumber}`}
        className="mx-auto max-w-full bg-white"
        hidden={!pdf || rendering || Boolean(error)}
      />
      <p className="sr-only" data-testid="pdf-page-text">
        {pageText}
      </p>
    </section>
  );
}
