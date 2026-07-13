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
  dueDate: string | null;
  attachmentUrl: string | null;
  assignedTo: { id: string; name: string; email: string };
  createdBy: { id: string; name: string; email: string };
  relatedShipment: { id: string; shipmentCode: string; customerName: string } | null;
};

export default function TaskDetailClient({ taskId, canManage }: { taskId: string; canManage: boolean }) {
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
      setSuccessMessage("Cập nhật nhiệm vụ thành công.");
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

  if (isLoading) return <div className="p-8 text-gray-400">Đang tải...</div>;
  if (loadError || !task) {
    return (
      <div className="p-8">
        <p className="text-red-600">{loadError || "Không tìm thấy nhiệm vụ."}</p>
        <Link href="/tasks" className="mt-4 inline-block text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/tasks" className="text-sm text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <div className="mt-2 flex items-center gap-3">
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
      <AttachmentPreviewModal
        key={previewUrl}
        attachment={previewUrl ? { name: previewUrl.split("/").pop() || "file", url: previewUrl, uploadedAt: "" } : null}
        onClose={() => setPreviewUrl(null)}
      />
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
