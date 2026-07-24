"use client";

import { useRef, useState } from "react";
import { mergeUniqueAttachments, type Attachment } from "@/lib/shipment-constants";
import AttachmentPreviewModal from "./AttachmentPreviewModal";

export default function AttachmentsCell({
  shipmentId,
  attachments,
  onAttached,
}: {
  shipmentId: string;
  attachments: Attachment[];
  onAttached: (shipmentId: string, attachments: Attachment[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Attachment | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.success) {
        throw new Error(uploadJson.error || "Tải tệp lên thất bại.");
      }

      const newAttachment: Attachment = {
        name: uploadJson.data.name,
        url: uploadJson.data.url,
        uploadedAt: new Date().toISOString(),
      };
      const nextAttachments = mergeUniqueAttachments(attachments, [newAttachment]);

      const patchRes = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachments: nextAttachments }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok || !patchJson.success) {
        throw new Error(patchJson.error || "Cập nhật chứng từ thất bại.");
      }

      onAttached(shipmentId, nextAttachments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {attachments.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {attachments.map((file, index) => (
            <button
              key={`${file.url}-${index}`}
              type="button"
              onClick={() => setPreviewing(file)}
              className="max-w-[160px] truncate text-left text-xs text-blue-600 hover:underline"
              title={file.name}
            >
              {file.name}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="w-fit whitespace-nowrap rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {isUploading ? "Đang tải..." : "+ Đính kèm"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
      <AttachmentPreviewModal key={previewing?.url} attachment={previewing} onClose={() => setPreviewing(null)} />
    </div>
  );
}
