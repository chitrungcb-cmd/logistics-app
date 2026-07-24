"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import type { TextLayer } from "pdfjs-dist/types/src/display/text_layer";

export default function PdfPreview({ url, name }: { url: string; name: string }) {
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const textLayerRefs = useRef(new Map<number, HTMLDivElement>());
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.25);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      try {
        const pdfjs = await import("pdfjs-dist");
        setPageCount(0);
        setError(null);
        setIsLoading(true);
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const loadingTask = pdfjs.getDocument({ url, withCredentials: true });
        loadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        documentRef.current = pdf;
        setPageCount(pdf.numPages);
      } catch (loadError) {
        if (cancelled) return;
        console.error("PDF preview failed:", loadError);
        setError("Không thể mở bản xem trước PDF. Bạn vẫn có thể tải tệp xuống.");
        setIsLoading(false);
      }
    }

    void loadDocument();
    return () => {
      cancelled = true;
      documentRef.current = null;
      const loadingTask = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [url]);

  useEffect(() => {
    const pdf = documentRef.current;
    if (!pdf || pageCount === 0) return;

    let cancelled = false;
    const renderTasks: RenderTask[] = [];
    const textLayers: TextLayer[] = [];
    setIsLoading(true);
    setError(null);

    async function renderPages(pdfDocument: PDFDocumentProxy) {
      try {
        const pdfjs = await import("pdfjs-dist");
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdfDocument.getPage(pageNumber);
          const canvas = canvasRefs.current.get(pageNumber);
          const textLayerContainer = textLayerRefs.current.get(pageNumber);
          if (!canvas || !textLayerContainer || cancelled) return;

          const viewport = page.getViewport({ scale: zoom });
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const renderTask = page.render({
            canvas,
            viewport,
            transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          });
          renderTasks.push(renderTask);
          await renderTask.promise;

          const textContent = await page.getTextContent({
            includeMarkedContent: true,
            disableNormalization: true,
          });
          if (cancelled) return;

          textLayerContainer.replaceChildren();
          textLayerContainer.style.setProperty("--total-scale-factor", String(zoom));
          textLayerContainer.style.setProperty("--scale-round-x", "1px");
          textLayerContainer.style.setProperty("--scale-round-y", "1px");
          const textLayer = new pdfjs.TextLayer({
            textContentSource: textContent,
            container: textLayerContainer,
            viewport,
          });
          textLayers.push(textLayer);
          await textLayer.render();
        }
        if (!cancelled) setIsLoading(false);
      } catch (renderError) {
        if (
          cancelled ||
          (renderError instanceof Error && renderError.name === "RenderingCancelledException")
        ) {
          return;
        }
        console.error("PDF page rendering failed:", renderError);
        setError("Không thể hiển thị đầy đủ nội dung PDF. Bạn vẫn có thể tải tệp xuống.");
        setIsLoading(false);
      }
    }

    void renderPages(pdf);
    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel());
      textLayers.forEach((textLayer) => textLayer.cancel());
    };
  }, [pageCount, zoom]);

  if (error) {
    return <p className="m-auto rounded-lg bg-red-950/70 px-4 py-3 text-sm text-red-100">{error}</p>;
  }

  return (
    <section className="flex h-full min-h-0 w-full max-w-[1440px] flex-col overflow-hidden rounded-lg bg-[#e8eaed] text-gray-900 shadow-2xl">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-300 bg-white px-3 text-sm">
        <span className="min-w-0 truncate text-gray-600">
          {pageCount > 0 ? `${pageCount} trang` : `Đang mở ${name}...`}
        </span>
        <div className="flex shrink-0 items-center gap-1" aria-label="Điều khiển thu phóng PDF">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
            disabled={zoom <= 0.75}
            className="h-8 w-8 rounded text-lg text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Thu nhỏ"
          >
            −
          </button>
          <span className="w-14 text-center text-xs font-medium text-gray-600">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}
            disabled={zoom >= 2.5}
            className="h-8 w-8 rounded text-lg text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Phóng to"
          >
            +
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {isLoading && (
          <p className="sticky left-0 top-0 z-10 bg-gray-900/75 px-3 py-2 text-center text-xs text-white">
            Đang hiển thị PDF...
          </p>
        )}
        <div className="flex min-w-max flex-col items-center gap-4 p-3 sm:p-5">
          {Array.from({ length: pageCount }, (_, index) => {
            const pageNumber = index + 1;
            return (
              <div key={pageNumber} className="relative bg-white shadow-lg">
                <canvas
                  ref={(canvas) => {
                    if (canvas) canvasRefs.current.set(pageNumber, canvas);
                    else canvasRefs.current.delete(pageNumber);
                  }}
                  className="block bg-white"
                  aria-label={`Trang ${pageNumber} của ${name}`}
                />
                <div
                  ref={(textLayer) => {
                    if (textLayer) textLayerRefs.current.set(pageNumber, textLayer);
                    else textLayerRefs.current.delete(pageNumber);
                  }}
                  className="pdf-text-layer"
                  aria-label={`Nội dung chữ trang ${pageNumber}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

