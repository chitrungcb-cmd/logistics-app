"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { isHysAttachment, type Attachment } from "@/lib/shipment-constants";

const PdfPreview = dynamic(() => import("./PdfPreview"), {
  ssr: false,
  loading: () => <p className="text-sm text-white/65">Đang tải trình xem PDF...</p>,
});

type SheetPreview = { name: string; html: string; text: string; showGridLines: boolean };

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

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" strokeLinecap="round" />
    </svg>
  );
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Không thể sao chép nội dung.");
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
  shipmentId,
  onAttachmentReplaced,
}: {
  attachment: Attachment | null;
  onClose: () => void;
  shipmentId?: string;
  onAttachmentReplaced?: (current: Attachment, replacement: Attachment) => void;
}) {
  const ext = attachment ? getExtension(attachment.name) : "";
  const isPdf = ext === "pdf";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
  const isSpreadsheet = ext === "xlsx";
  const isPreviewable = isPdf || isImage || isSpreadsheet;
  const canEditHys = Boolean(
    attachment &&
      shipmentId &&
      onAttachmentReplaced &&
      isSpreadsheet &&
      isHysAttachment(attachment.name)
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const sheetPreviewRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hysChangesRef = useRef<Record<string, string>>({});
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  // Callers remount the modal with an attachment URL key, keeping file-specific state isolated.
  const [isLoading, setIsLoading] = useState(isSpreadsheet);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [isEditingHys, setIsEditingHys] = useState(false);
  const [isSavingHys, setIsSavingHys] = useState(false);
  const [hysSaveError, setHysSaveError] = useState<string | null>(null);

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
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [attachment, onClose]);

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

  useEffect(() => {
    const container = sheetPreviewRef.current;
    const sheetName = sheets?.[activeSheet]?.name;
    if (!container || !sheetName) return;

    container.querySelectorAll<HTMLTableCellElement>("td[data-cell-address]").forEach((cell) => {
      const address = cell.dataset.cellAddress;
      if (!address) return;

      const changedValue = hysChangesRef.current[`${sheetName}\u0000${address}`];
      if (changedValue !== undefined && cell.textContent !== changedValue) {
        cell.textContent = changedValue;
      }

      const editable = isEditingHys && cell.dataset.editable === "true";
      cell.contentEditable = editable ? "true" : "false";
      cell.spellcheck = false;
      cell.tabIndex = editable ? 0 : -1;
      cell.setAttribute("aria-label", editable ? `Sửa ô ${address}` : `Ô ${address}`);
    });
  }, [activeSheet, isEditingHys, isSavingHys, sheets]);

  if (!attachment) return null;

  const activeSheetData = sheets?.[activeSheet] ?? sheets?.[0];

  async function handleCopy() {
    if (!activeSheetData) return;

    const selection = window.getSelection();
    const selectionNode = selection?.anchorNode;
    const selectedText = selectionNode && sheetPreviewRef.current?.contains(selectionNode)
      ? selection?.toString().trim()
      : "";

    try {
      await copyToClipboard(selectedText || activeSheetData.text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }

    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = setTimeout(() => setCopyStatus("idle"), 2_000);
  }

  function handleHysInput(event: React.FormEvent<HTMLDivElement>) {
    if (!isEditingHys || !activeSheetData) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const cell = target.closest<HTMLTableCellElement>("td[data-cell-address]");
    const address = cell?.dataset.cellAddress;
    if (!cell || !address || cell.dataset.editable !== "true") return;
    hysChangesRef.current[`${activeSheetData.name}\u0000${address}`] =
      (cell.innerText || "").replace(/\r\n/g, "\n");
  }

  function cancelHysEditing() {
    hysChangesRef.current = {};
    setHysSaveError(null);
    setIsEditingHys(false);
    if (sheetPreviewRef.current && activeSheetData) {
      sheetPreviewRef.current.innerHTML = activeSheetData.html;
    }
  }

  async function saveHysChanges() {
    if (!attachment || !shipmentId || !onAttachmentReplaced) return;

    const changes = Object.entries(hysChangesRef.current).map(([key, value]) => {
      const [sheetName, address] = key.split("\u0000");
      return { sheetName, address, value };
    });
    if (changes.length === 0) {
      setHysSaveError("Chưa có ô nào được thay đổi.");
      return;
    }

    setIsSavingHys(true);
    setHysSaveError(null);
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/attachments/hys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentUrl: attachment.url, changes }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || "Không thể lưu tệp HYS.");
      }

      hysChangesRef.current = {};
      setIsEditingHys(false);
      onAttachmentReplaced(attachment, json.data.attachment as Attachment);
    } catch (saveError) {
      setHysSaveError(
        saveError instanceof Error ? saveError.message : "Không thể lưu tệp HYS."
      );
    } finally {
      setIsSavingHys(false);
    }
  }

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
          {canEditHys && !isEditingHys && (
            <button
              type="button"
              onClick={() => {
                hysChangesRef.current = {};
                setHysSaveError(null);
                setIsEditingHys(true);
              }}
              className="inline-flex h-10 items-center rounded-full px-3 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white"
            >
              Sửa HYS
            </button>
          )}
          {isSpreadsheet && activeSheetData && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white"
              aria-label="Sao chép nội dung trang tính"
              title="Bôi đen để sao chép một phần, hoặc bấm để sao chép toàn bộ trang"
            >
              <CopyIcon />
              <span className="hidden sm:inline" aria-live="polite">
                {copyStatus === "copied" ? "Đã sao chép" : copyStatus === "error" ? "Không thể sao chép" : "Sao chép"}
              </span>
            </button>
          )}
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
        {isPdf && <PdfPreview url={attachment.url} name={attachment.name} />}

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
                {isEditingHys && (
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-amber-900">
                        Bấm vào ô cần sửa rồi nhập nội dung mới.
                      </p>
                      <p className="text-xs text-amber-700">
                        Lưu sẽ thay bản HYS hiện tại, không tạo lịch sử chỉnh sửa.
                      </p>
                      {hysSaveError && (
                        <p className="mt-1 text-xs font-medium text-red-600">{hysSaveError}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelHysEditing}
                        disabled={isSavingHys}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={saveHysChanges}
                        disabled={isSavingHys}
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {isSavingHys ? "Đang lưu..." : "Lưu HYS"}
                      </button>
                    </div>
                  </div>
                )}
                <nav className="flex min-h-12 shrink-0 items-end gap-1 overflow-x-auto border-b border-gray-200 px-4" aria-label="Trang tính">
                  {sheets.map((sheet, index) => (
                    <button
                      key={`${sheet.name}-${index}`}
                      type="button"
                      onClick={() => {
                        setActiveSheet(index);
                        setCopyStatus("idle");
                      }}
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
                    ref={sheetPreviewRef}
                    onInput={handleHysInput}
                    className={`mx-auto w-fit max-w-none select-text rounded-sm bg-white text-xs shadow-sm [&_table]:max-w-none [&_td]:px-0.5 [&_td]:py-0 [&_td]:align-middle ${
                      isEditingHys
                        ? "[&_td[data-editable='true']]:cursor-text [&_td[data-editable='true']]:outline-1 [&_td[data-editable='true']]:outline-transparent [&_td[data-editable='true']:focus]:relative [&_td[data-editable='true']:focus]:z-10 [&_td[data-editable='true']:focus]:outline-2 [&_td[data-editable='true']:focus]:outline-blue-500"
                        : ""
                    } ${
                      activeSheetData.showGridLines ? "[&_td]:border [&_td]:border-gray-200" : ""
                    }`}
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
