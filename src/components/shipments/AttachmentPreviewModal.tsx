"use client";

import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@/lib/shipment-constants";

type SheetPreview = { name: string; html: string };

function getExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.8">
      <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

function FileIcon({ extension }: { extension: string }) {
  const label = extension ? extension.slice(0, 4).toUpperCase() : "FILE";
  const isExcel = ["xlsx", "xls", "csv"].includes(extension);

  return (
    <span
      className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded px-1.5 text-[9px] font-bold tracking-wide text-white ${
        isExcel ? "bg-emerald-600" : extension === "pdf" ? "bg-red-600" : "bg-blue-600"
      }`}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

export default function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: Attachment | null;
  onClose: () => void;
}) {
  const ext = attachment ? getExtension(attachment.name) : "";
  const isPdf = ext === "pdf";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
  const isSpreadsheet = ext === "xlsx";
  const isPreviewable = isPdf || isImage || isSpreadsheet;

  const dialogRef = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  // Callers remount the modal with an attachment URL key, keeping file-specific state isolated.
  const [isLoading, setIsLoading] = useState(isSpreadsheet);
  const [error, setError] = useState<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(isPdf);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!attachment) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [attachment, onClose]);

  useEffect(() => {
    if (!attachment || !isPdf) return;

    const controller = new AbortController();
    let objectUrl: string | null = null;
    let cancelled = false;

    fetch(attachment.url, { credentials: "same-origin", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Không thể tải nội dung PDF.");
        const sourceBlob = await res.blob();
        if ((await sourceBlob.slice(0, 5).text()) !== "%PDF-") {
          throw new Error("Tệp trả về không phải định dạng PDF hợp lệ.");
        }
        const blob = sourceBlob.type.toLowerCase().includes("pdf")
          ? sourceBlob
          : new Blob([sourceBlob], { type: "application/pdf" });

        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setPdfObjectUrl(nextObjectUrl);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPdfError(err instanceof Error ? err.message : "Không thể xem trước tệp PDF.");
      })
      .finally(() => {
        if (!cancelled) setIsPdfLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, isPdf]);

  useEffect(() => {
    if (!attachment || !isSpreadsheet) return;

    const controller = new AbortController();
    fetch(`/api/attachments/preview?url=${encodeURIComponent(attachment.url)}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Không thể xem trước tệp.");
        return json.data.sheets as SheetPreview[];
      })
      .then((nextSheets) => {
        if (nextSheets.length === 0) throw new Error("Tệp không có trang tính để hiển thị.");
        setSheets(nextSheets);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [attachment, isSpreadsheet]);

  if (!attachment) return null;

  const activeSheetData = sheets?.[activeSheet] ?? sheets?.[0];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Xem trước ${attachment.name}`}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-[#202124]/95 text-white outline-none"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <FileIcon extension={ext} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-white sm:text-base">{attachment.name}</h2>
            <p className="hidden text-xs text-white/55 sm:block">Xem trước tệp đính kèm</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <a
            href={attachment.url}
            download={attachment.name}
            className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white"
            aria-label={`Tải xuống ${attachment.name}`}
          >
            <DownloadIcon />
            <span className="hidden sm:inline">Tải xuống</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Đóng trình xem"
            title="Đóng (Esc)"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-5">
        {isPdf && isPdfLoading && <p className="text-sm text-white/65">Đang tải PDF...</p>}
        {isPdf && pdfError && <p className="rounded-lg bg-red-950/70 px-4 py-3 text-sm text-red-100">{pdfError}</p>}
        {isPdf && pdfObjectUrl && (
          <iframe
            src={pdfObjectUrl}
            className="h-full w-full max-w-[1440px] rounded-lg bg-white shadow-2xl"
            title={attachment.name}
          />
        )}

        {isImage && (
          // Arbitrary uploaded dimensions cannot be known ahead of time for next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={attachment.name}
            className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
          />
        )}

        {isSpreadsheet && (
          <section className="flex h-full min-h-0 w-full max-w-[1800px] flex-col overflow-hidden rounded-lg bg-white text-gray-900 shadow-2xl">
            {isLoading && <p className="m-auto text-sm text-gray-500">Đang mở bảng tính...</p>}
            {error && (
              <div className="m-auto flex max-w-md flex-col items-center gap-3 px-5 text-center">
                <p className="text-sm text-red-600">{error}</p>
                <a
                  href={attachment.url}
                  download={attachment.name}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Tải xuống để xem
                </a>
              </div>
            )}
            {sheets && activeSheetData && (
              <>
                <nav className="flex min-h-12 shrink-0 items-end gap-1 overflow-x-auto border-b border-gray-200 px-4" aria-label="Trang tính">
                  {sheets.map((sheet, index) => (
                    <button
                      key={`${sheet.name}-${index}`}
                      type="button"
                      onClick={() => setActiveSheet(index)}
                      className={`h-12 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors ${
                        index === activeSheet
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
                      }`}
                      aria-current={index === activeSheet ? "page" : undefined}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </nav>
                <div className="min-h-0 flex-1 overflow-auto bg-[#f8fafd] p-3 sm:p-5">
                  {/* Cell text is escaped by the authenticated Excel preview endpoint. */}
                  <div
                    className="w-max min-w-full rounded-sm bg-white text-xs shadow-sm [&_table]:min-w-full [&_td]:border [&_td]:border-gray-200 [&_td]:px-1.5 [&_td]:py-1 [&_td]:align-middle"
                    dangerouslySetInnerHTML={{ __html: activeSheetData.html }}
                  />
                </div>
              </>
            )}
          </section>
        )}

        {!isPreviewable && (
          <div className="flex max-w-md flex-col items-center justify-center gap-4 rounded-xl bg-white/10 px-8 py-10 text-center text-white/80">
            <FileIcon extension={ext} />
            <div>
              <p className="font-medium text-white">Chưa thể xem trực tiếp loại tệp này</p>
              <p className="mt-1 text-sm text-white/60">Bạn vẫn có thể tải tệp xuống để mở trên thiết bị.</p>
            </div>
            <a
              href={attachment.url}
              download={attachment.name}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
            >
              <DownloadIcon />
              Tải xuống
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
