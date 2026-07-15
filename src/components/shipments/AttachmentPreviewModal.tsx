"use client";

import { useEffect, useState } from "react";
import type { Attachment } from "@/lib/shipment-constants";

type SheetPreview = { name: string; html: string };

function getExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
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

  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  // Starts true when this instance opens on a spreadsheet — remounted fresh per attachment (see the
  // `key` prop callers pass), so there's no stale-state case an effect would otherwise need to reset.
  const [isLoading, setIsLoading] = useState(isSpreadsheet);
  const [error, setError] = useState<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(isPdf);
  const [pdfError, setPdfError] = useState<string | null>(null);

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
        // Some static hosts return application/octet-stream even for a valid PDF. Give the
        // in-memory URL an explicit type so Chrome's built-in viewer can render it consistently.
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
    // The modal is remounted with a key when the selected attachment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.url, isPdf]);

  useEffect(() => {
    if (!attachment || !isSpreadsheet) return;

    fetch(`/api/attachments/preview?url=${encodeURIComponent(attachment.url)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể xem trước tệp.");
        setSheets(json.data.sheets);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.url]);

  if (!attachment) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`flex h-full max-h-[90vh] w-full flex-col rounded-lg bg-white shadow-xl ${
          isSpreadsheet ? "max-w-[95vw]" : "max-w-4xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="truncate text-sm font-medium text-gray-900">{attachment.name}</h3>
          <div className="flex items-center gap-3">
            <a
              href={attachment.url}
              download={attachment.name}
              className="text-sm text-blue-600 hover:underline"
            >
              Tải xuống
            </a>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Đóng"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {isPdf && isPdfLoading && <p className="text-center text-gray-400">Đang tải PDF...</p>}
          {isPdf && pdfError && <p className="text-center text-red-600">{pdfError}</p>}
          {isPdf && pdfObjectUrl && (
            <iframe src={pdfObjectUrl} className="h-full min-h-[70vh] w-full" title={attachment.name} />
          )}

          {isImage && (
            // Unknown natural size (arbitrary uploaded file) — next/image needs fixed dimensions or a sized fill parent.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.url} alt={attachment.name} className="mx-auto max-h-full max-w-full" />
          )}

          {isSpreadsheet && (
            <>
              {isLoading && <p className="text-center text-gray-400">Đang tải...</p>}
              {error && <p className="text-center text-red-600">{error}</p>}
              {sheets && sheets.length > 0 && (
                <div>
                  {sheets.length > 1 && (
                    <div className="mb-3 flex gap-2 border-b border-gray-200">
                      {sheets.map((sheet, index) => (
                        <button
                          key={sheet.name}
                          type="button"
                          onClick={() => setActiveSheet(index)}
                          className={`px-3 py-1.5 text-sm font-medium ${
                            index === activeSheet
                              ? "border-b-2 border-blue-600 text-blue-600"
                              : "text-gray-500 hover:text-gray-700"
                          }`}
                        >
                          {sheet.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Safe HTML returned by the authenticated Excel preview endpoint. */}
                  <div
                    className="overflow-x-auto text-xs [&_table]:border-collapse [&_td]:border [&_td]:border-gray-200 [&_td]:px-1.5 [&_td]:py-0.5 [&_td]:align-top [&_td]:whitespace-nowrap"
                    dangerouslySetInnerHTML={{ __html: sheets[activeSheet].html }}
                  />
                </div>
              )}
            </>
          )}

          {!isPreviewable && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
              <p>Không thể xem trước loại tệp này.</p>
              <a
                href={attachment.url}
                download={attachment.name}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Tải xuống để xem
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
