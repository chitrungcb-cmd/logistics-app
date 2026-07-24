"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Badge from "@/components/shipments/Badge";
import AttachmentPreviewModal from "@/components/shipments/AttachmentPreviewModal";
import { TASK_STATUS_LABELS, TASK_STATUS_OPTIONS, taskStatusBadgeClass } from "@/lib/task-constants";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  updatedAt: string;
  dueDate: string | null;
  attachmentUrl: string | null;
  assignedTo: { id: string; name: string; email: string };
  createdBy: { id: string; name: string; email: string };
  relatedShipment: { id: string; shipmentCode: string; customerName: string } | null;
  statusLogs: Array<{
    id: string;
    fromStatus: string;
    toStatus: string;
    createdAt: string;
    actor: { id: string; name: string };
  }>;
};

export default function TaskDetailClient({
  taskId,
  canManage,
  embedded = false,
  onTaskUpdated,
}: {
  taskId: string;
  canManage: boolean;
  embedded?: boolean;
  onTaskUpdated?: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [status, setStatus] = useState<string>(TASK_STATUS_OPTIONS[0]);
  const [description, setDescription] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProgressDetailOpen, setIsProgressDetailOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error);
        const data: Task = json.data;
        setTask(data);
        setStatus(data.status);
        setDescription(data.description || "");
        setAttachmentUrl(data.attachmentUrl);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [taskId]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Tải file thất bại.");
      setAttachmentUrl(json.data.url);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, description, attachmentUrl }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Cập nhật thất bại.");
      setTask(json.data);
      onTaskUpdated?.();
      setSuccessMessage("Cập nhật nhiệm vụ thành công.");
      setIsProgressDetailOpen(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Xóa nhiệm vụ này?")) return;
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    router.push("/tasks");
  }

  if (isLoading) return <div className={`${embedded ? "p-6" : "p-8"} text-gray-400`}>Đang tải...</div>;
  if (loadError || !task) {
    return (
      <div className={embedded ? "p-6" : "p-8"}>
        <p className="text-red-600">{loadError || "Không tìm thấy nhiệm vụ."}</p>
        {!embedded && (
          <Link href="/tasks" className="mt-4 inline-block text-blue-600 hover:underline">
            ← Quay lại danh sách
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={embedded ? "p-5 sm:p-6" : "p-8"}>
      <div className="mb-6">
        {!embedded && (
          <Link href="/tasks" className="text-sm text-blue-600 hover:underline">
            ← Quay lại danh sách
          </Link>
        )}
        <div className={`${embedded ? "" : "mt-2"} flex items-center gap-3`}>
          <h1 className="text-2xl font-semibold text-gray-900">{task.title}</h1>
          <Badge label={TASK_STATUS_LABELS[task.status] ?? task.status} className={taskStatusBadgeClass(task.status)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-gray-200 bg-white p-6 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Thông tin nhiệm vụ</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Info label="Giao cho" value={`${task.assignedTo.name} (${task.assignedTo.email})`} />
            <Info label="Người giao" value={`${task.createdBy.name} (${task.createdBy.email})`} />
            <Info
              label="Hạn hoàn thành"
              value={task.dueDate ? new Date(task.dueDate).toLocaleDateString("vi-VN") : null}
            />
            <Info
              label="Lô hàng liên quan"
              value={
                task.relatedShipment
                  ? `${task.relatedShipment.customerName} (${task.relatedShipment.shipmentCode})`
                  : null
              }
            />
          </dl>

          {task.attachmentUrl && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Chứng từ đính kèm</h3>
              <button
                type="button"
                onClick={() => setPreviewUrl(task.attachmentUrl)}
                className="text-sm text-blue-600 hover:underline"
              >
                Xem file đính kèm
              </button>
            </div>
          )}

          {canManage && (
            <div className="mt-6">
              <button
                type="button"
                onClick={handleDelete}
                className="text-sm text-red-600 hover:underline"
              >
                Xóa nhiệm vụ
              </button>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Cập nhật</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Trạng thái</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
                {TASK_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {TASK_STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Mô tả / Ghi chú tiến độ
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="input"
              />
            </label>

            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">Chứng từ hoàn thành</span>
              {attachmentUrl && (
                <button
                  type="button"
                  onClick={() => setPreviewUrl(attachmentUrl)}
                  className="mb-2 block truncate text-left text-sm text-blue-600 hover:underline"
                >
                  {attachmentUrl.split("/").pop()}
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {isUploading ? "Đang tải..." : attachmentUrl ? "Thay file khác" : "+ Đính kèm file"}
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
            </div>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            {successMessage && <p className="text-sm text-green-600">{successMessage}</p>}

            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? "Đang lưu..." : "Lưu cập nhật"}
            </button>
          </form>
        </section>
      </div>
      {isProgressDetailOpen && (
        <ProgressDetailModal
          task={task}
          onClose={() => setIsProgressDetailOpen(false)}
          onPreviewAttachment={(url) => setPreviewUrl(url)}
        />
      )}
      <AttachmentPreviewModal
        key={previewUrl}
        attachment={previewUrl ? { name: previewUrl.split("/").pop() || "file", url: previewUrl, uploadedAt: "" } : null}
        onClose={() => setPreviewUrl(null)}
      />
    </div>
  );
}

function ProgressDetailModal({
  task,
  onClose,
  onPreviewAttachment,
}: {
  task: Task;
  onClose: () => void;
  onPreviewAttachment: (url: string) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-detail-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-blue-600">Đã cập nhật thành công</p>
            <h2 id="progress-detail-title" className="mt-1 text-xl font-semibold text-gray-900">
              Chi tiết tiến trình
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Đóng cửa sổ chi tiết tiến trình"
          >
            ×
          </button>
        </header>

        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-4">
            <div>
              <p className="text-lg font-semibold text-gray-900">{task.title}</p>
              <p className="mt-1 text-sm text-gray-500">
                Cập nhật lúc {new Date(task.updatedAt).toLocaleString("vi-VN")}
              </p>
            </div>
            <Badge
              label={TASK_STATUS_LABELS[task.status] ?? task.status}
              className={taskStatusBadgeClass(task.status)}
            />
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Info label="Người phụ trách" value={`${task.assignedTo.name} (${task.assignedTo.email})`} />
            <Info label="Người giao việc" value={`${task.createdBy.name} (${task.createdBy.email})`} />
          </dl>

          <section>
            <h3 className="text-sm font-semibold text-gray-900">Ghi chú tiến độ</h3>
            <p className="mt-2 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
              {task.description || "Chưa có ghi chú."}
            </p>
          </section>

          {task.attachmentUrl && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900">Chứng từ đính kèm</h3>
              <button
                type="button"
                onClick={() => onPreviewAttachment(task.attachmentUrl!)}
                className="mt-2 text-sm font-medium text-blue-600 hover:underline"
              >
                Xem {task.attachmentUrl.split("/").pop() || "file đính kèm"}
              </button>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-gray-900">Lịch sử trạng thái</h3>
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {task.statusLogs.map((log) => (
                <li key={log.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-3 text-sm">
                  <span className="text-gray-700">
                    {TASK_STATUS_LABELS[log.fromStatus] ?? log.fromStatus} →{" "}
                    <span className="font-medium">{TASK_STATUS_LABELS[log.toStatus] ?? log.toStatus}</span>
                    {" · "}
                    {log.actor.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(log.createdAt).toLocaleString("vi-VN")}
                  </span>
                </li>
              ))}
              {task.statusLogs.length === 0 && (
                <li className="px-3 py-4 text-sm text-gray-400">
                  Chưa có lần thay đổi trạng thái nào được ghi nhận.
                </li>
              )}
            </ul>
          </section>
        </div>

        <footer className="flex justify-end border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Đóng
          </button>
        </footer>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value || "—"}</dd>
    </div>
  );
}
