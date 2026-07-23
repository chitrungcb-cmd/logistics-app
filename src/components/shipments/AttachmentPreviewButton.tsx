"use client";

import { useState } from "react";
import AttachmentPreviewModal from "./AttachmentPreviewModal";

function fileNameFromUrl(url: string) {
  const rawName = url.split(/[?#]/, 1)[0].split("/").pop() || "file";
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

export default function AttachmentPreviewButton({
  url,
  name,
  children,
  className,
}: {
  url: string;
  name?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const fileName = name?.trim() || fileNameFromUrl(url);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={className} title={`Xem ${fileName}`}>
        {children}
      </button>
      <AttachmentPreviewModal
        key={isOpen ? url : "closed"}
        attachment={isOpen ? { name: fileName, url, uploadedAt: "" } : null}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
