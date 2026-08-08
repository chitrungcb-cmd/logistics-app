"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadExcel } from "@/lib/export-excel";
import {
  OTHER_EXPENSE_CATEGORY_LABELS,
  OTHER_EXPENSE_CATEGORY_OPTIONS,
  OTHER_EXPENSE_PAYMENT_METHODS,
  OTHER_ENTRY_TYPES,
  OTHER_ENTRY_TYPE_LABELS,
  otherEntryCategoryLabel,
  otherEntryCategoryStyle,
  type OtherEntryType,
  type OtherExpenseCategory,
} from "@/lib/other-expense-constants";
import AttachmentPreviewButton from "@/components/shipments/AttachmentPreviewButton";
import MoneyInput from "@/components/MoneyInput";

const PAGE_SIZE = 20;

type OtherExpense = {
  id: string;
  type: OtherEntryType;
  category: OtherExpenseCategory;
  description: string;
  amount: number;
  expenseDate: string;
  payee: string | null;
  paymentMethod: string | null;
  companyAccount: { id: string; name: string } | null;
  invoiceNumber: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  note: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

type ExpenseForm = {
  type: OtherEntryType;
  category: OtherExpenseCategory;
  description: string;
  amount: string;
  expenseDate: string;
  payee: string;
  paymentMethod: string;
  companyAccountId: string;
  invoiceNumber: string;
  attachmentName: string;
  attachmentUrl: string;
  note: string;
};

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyForm(): ExpenseForm {
  return {
    type: "CHI",
    category: "TIEP_KHACH",
    description: "",
    amount: "",
    expenseDate: localDateInputValue(),
    payee: "",
    paymentMethod: "",
    companyAccountId: "",
    invoiceNumber: "",
    attachmentName: "",
    attachmentUrl: "",
    note: "",
  };
}

function formatVnd(amount: number) {
  return `${amount.toLocaleString("vi-VN")} đ`;
}

function expenseDateValue(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

async function readApiJson(response: Response) {
  const text = await response.text();
  if (!text) throw new Error(`Máy chủ không trả về dữ liệu (HTTP ${response.status}).`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Phản hồi máy chủ không hợp lệ (HTTP ${response.status}).`);
  }
}

export default function OtherExpensesClient() {
  const [expenses, setExpenses] = useState<OtherExpense[]>([]);
  const [companyAccounts, setCompanyAccounts] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState({
    query: "",
    type: "",
    category: "",
    dateFrom: "",
    dateTo: "",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [editingExpense, setEditingExpense] = useState<OtherExpense | null | undefined>(undefined);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/other-expenses", { cache: "no-store" })
      .then(readApiJson)
      .then((json) => {
        if (cancelled) return;
        if (!json.success || !Array.isArray(json.data)) {
          throw new Error(json.error || "Không thể tải chi phí khác.");
        }
        setExpenses(json.data);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Đã có lỗi xảy ra.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    fetch("/api/company-accounts", { cache: "no-store" })
      .then(readApiJson)
      .then((json) => {
        if (json.success && Array.isArray(json.data)) setCompanyAccounts(json.data);
      })
      .catch(() => {});
  }, []);

  const filteredExpenses = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return expenses.filter((expense) => {
      if (filters.type && expense.type !== filters.type) return false;
      if (filters.category && expense.category !== filters.category) return false;
      const date = expenseDateValue(expense.expenseDate);
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
      if (
        query &&
        ![
          expense.description,
          expense.payee,
          expense.invoiceNumber,
          expense.note,
          otherEntryCategoryLabel(expense.type, expense.category),
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      ) {
        return false;
      }
      return true;
    });
  }, [expenses, filters]);

  const totals = useMemo(() => {
    let thu = 0;
    let chi = 0;
    for (const expense of filteredExpenses) {
      if (expense.type === "THU") thu += expense.amount;
      else chi += expense.amount;
    }
    return { thu, chi, net: thu - chi };
  }, [filteredExpenses]);

  const pageCount = Math.max(1, Math.ceil(filteredExpenses.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, pageCount);
  const paginatedExpenses = filteredExpenses.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function updateFilters(patch: Partial<typeof filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setCurrentPage(1);
  }

  function openCreate() {
    setForm(emptyForm());
    setFormError(null);
    setEditingExpense(null);
  }

  function openEdit(expense: OtherExpense) {
    setForm({
      type: expense.type,
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      expenseDate: expenseDateValue(expense.expenseDate),
      payee: expense.payee || "",
      paymentMethod: expense.paymentMethod || "",
      companyAccountId: expense.companyAccount?.id || "",
      invoiceNumber: expense.invoiceNumber || "",
      attachmentName: expense.attachmentName || "",
      attachmentUrl: expense.attachmentUrl || "",
      note: expense.note || "",
    });
    setFormError(null);
    setEditingExpense(expense);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!form.description.trim()) {
      setFormError("Vui lòng nhập nội dung.");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setFormError("Vui lòng nhập số tiền lớn hơn 0.");
      return;
    }
    if (!form.expenseDate) {
      setFormError("Vui lòng chọn ngày.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(
        editingExpense ? `/api/other-expenses/${editingExpense.id}` : "/api/other-expenses",
        {
          method: editingExpense ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu chi phí khác.");

      setExpenses((current) =>
        editingExpense
          ? current.map((expense) => (expense.id === json.data.id ? json.data : expense))
          : [json.data, ...current]
      );
      setEditingExpense(undefined);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAttachmentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    setFormError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải chứng từ.");
      setForm((current) => ({
        ...current,
        attachmentName: json.data.name || file.name,
        attachmentUrl: json.data.url,
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Không thể tải chứng từ.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(expense: OtherExpense) {
    if (!confirm(`Xóa khoản “${expense.description}”?`)) return;
    const response = await fetch(`/api/other-expenses/${expense.id}`, { method: "DELETE" });
    const json = await readApiJson(response);
    if (!response.ok || !json.success) {
      alert(json.error || "Không thể xóa chi phí khác.");
      return;
    }
    setExpenses((current) => current.filter((item) => item.id !== expense.id));
  }

  async function exportExpenses() {
    await downloadExcel(`thu-chi-khac-${localDateInputValue()}.xlsx`, [
      {
        name: "Thu chi khác",
        rows: filteredExpenses.map((expense, index) => ({
          STT: index + 1,
          Ngày: new Date(expense.expenseDate).toLocaleDateString("vi-VN"),
          "Loại": OTHER_ENTRY_TYPE_LABELS[expense.type],
          "Nhóm": otherEntryCategoryLabel(expense.type, expense.category),
          "Nội dung": expense.description,
          "Số tiền": expense.type === "THU" ? expense.amount : -expense.amount,
          "Người/đơn vị": expense.payee || "",
          "Phương thức": expense.paymentMethod || "",
          "Tài khoản": expense.companyAccount?.name || "",
          "Số hóa đơn": expense.invoiceNumber || "",
          "Ghi chú": expense.note || "",
          "Người nhập": expense.createdBy?.name || "",
        })),
      },
    ]);
  }

  const modalOpen = editingExpense !== undefined;

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Thu chi khác</h1>
          <p className="mt-1 text-sm text-gray-500">
            Theo dõi các khoản thu và chi vận hành ngoài lô hàng: tiếp khách, ăn uống, văn phòng phẩm, thu khác...
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportExpenses}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            📊 Xuất Excel
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Thêm khoản
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              setLoadError(null);
              setReloadKey((value) => value + 1);
            }}
            className="font-medium hover:underline"
          >
            Thử lại
          </button>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Tổng thu" value={formatVnd(totals.thu)} className="border-emerald-100 bg-emerald-50 text-emerald-800" />
        <Kpi label="Tổng chi" value={formatVnd(totals.chi)} className="border-red-100 bg-red-50 text-red-800" />
        <Kpi
          label="Chênh lệch (thu − chi)"
          value={`${totals.net < 0 ? "−" : ""}${formatVnd(Math.abs(totals.net))}`}
          className={totals.net < 0 ? "border-red-100 bg-red-50 text-red-800" : "border-blue-100 bg-blue-50 text-blue-800"}
        />
        <Kpi label="Số khoản" value={String(filteredExpenses.length)} className="border-gray-200 bg-white text-gray-900" />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            value={filters.query}
            onChange={(event) => updateFilters({ query: event.target.value })}
            placeholder="Tìm nội dung, người, số hóa đơn..."
            className="input xl:col-span-2"
          />
          <select value={filters.type} onChange={(event) => updateFilters({ type: event.target.value, category: "" })} className="input">
            <option value="">Thu & Chi</option>
            <option value="THU">Chỉ Thu</option>
            <option value="CHI">Chỉ Chi</option>
          </select>
          <select value={filters.category} onChange={(event) => updateFilters({ category: event.target.value })} className="input" disabled={filters.type === "THU"}>
            <option value="">Tất cả nhóm chi</option>
            {OTHER_EXPENSE_CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>{OTHER_EXPENSE_CATEGORY_LABELS[category]}</option>
            ))}
          </select>
          <input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} className="input" title="Từ ngày" />
          <input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} className="input" title="Đến ngày" />
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[1180px] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Ngày</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Loại / Nhóm</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Nội dung</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Người/đơn vị</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Thanh toán / HĐ</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500">Số tiền</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Người nhập</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Đang tải dữ liệu...</td></tr>
              )}
              {!isLoading && !loadError && paginatedExpenses.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Chưa có khoản thu chi nào phù hợp.</td></tr>
              )}
              {!isLoading && paginatedExpenses.map((expense) => (
                <tr key={expense.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                    {new Date(expense.expenseDate).toLocaleDateString("vi-VN")}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${otherEntryCategoryStyle(expense.type, expense.category)}`}>
                      {otherEntryCategoryLabel(expense.type, expense.category)}
                    </span>
                  </td>
                  <td className="max-w-sm px-3 py-3">
                    <p className="font-medium text-gray-900">{expense.description}</p>
                    {expense.note && <p className="mt-0.5 line-clamp-2 text-xs text-gray-400">{expense.note}</p>}
                    {expense.attachmentUrl && (
                      <AttachmentPreviewButton url={expense.attachmentUrl} name={expense.attachmentName} className="mt-1 inline-block text-xs text-blue-600 hover:underline">
                        📎 {expense.attachmentName || "Xem chứng từ"}
                      </AttachmentPreviewButton>
                    )}
                  </td>
                  <td className="max-w-xs px-3 py-3 text-gray-600">{expense.payee || "—"}</td>
                  <td className="px-3 py-3 text-gray-600">
                    <span>{expense.paymentMethod || "—"}</span>
                    {expense.companyAccount && <span className="block text-xs text-gray-500">TK: {expense.companyAccount.name}</span>}
                    <span className="block text-xs text-gray-400">HĐ: {expense.invoiceNumber || "—"}</span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${expense.type === "THU" ? "text-emerald-700" : "text-red-700"}`}>
                    {expense.type === "THU" ? "+" : "−"} {formatVnd(expense.amount)}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{expense.createdBy?.name || "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-3">
                      <button type="button" onClick={() => openEdit(expense)} className="font-medium text-blue-600 hover:underline">Sửa</button>
                      <button type="button" onClick={() => handleDelete(expense)} className="font-medium text-red-600 hover:underline">Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {!isLoading && filteredExpenses.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-right font-medium text-gray-700">
                    Chênh lệch ({filteredExpenses.length} khoản) · Thu {formatVnd(totals.thu)} − Chi {formatVnd(totals.chi)}
                  </td>
                  <td className={`px-3 py-3 text-right font-bold ${totals.net < 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {totals.net < 0 ? "−" : "+"} {formatVnd(Math.abs(totals.net))}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {!isLoading && filteredExpenses.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
            <span>Trang {safePage}/{pageCount}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage === 1} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">‹ Trước</button>
              <button type="button" onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} disabled={safePage === pageCount} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">Sau ›</button>
            </div>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingExpense(undefined)}>
          <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{editingExpense ? "Sửa khoản thu chi" : "Thêm khoản thu chi"}</h2>
                <p className="text-xs text-gray-500">Khoản này không liên kết với lô hàng hoặc nhà cung cấp.</p>
              </div>
              <button type="button" onClick={() => setEditingExpense(undefined)} className="text-xl text-gray-400 hover:text-gray-700">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Loại khoản *</span>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-gray-300 p-1">
                  {OTHER_ENTRY_TYPES.map((entryType) => (
                    <button
                      key={entryType}
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          type: entryType,
                          category: entryType === "THU" ? "KHAC" : current.category,
                        }))
                      }
                      className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                        form.type === entryType
                          ? entryType === "THU"
                            ? "bg-emerald-600 text-white"
                            : "bg-red-600 text-white"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {OTHER_ENTRY_TYPE_LABELS[entryType]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Ngày *</span>
                <input type="date" value={form.expenseDate} onChange={(event) => setForm((current) => ({ ...current, expenseDate: event.target.value }))} className="input" required />
              </label>
              {form.type === "CHI" && (
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Nhóm chi *</span>
                  <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as OtherExpenseCategory }))} className="input">
                    {OTHER_EXPENSE_CATEGORY_OPTIONS.map((category) => (
                      <option key={category} value={category}>{OTHER_EXPENSE_CATEGORY_LABELS[category]}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-gray-700">Nội dung *</span>
                <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="input" maxLength={300} placeholder={form.type === "THU" ? "Ví dụ: Thu lãi ngân hàng" : "Ví dụ: Tiếp khách Công ty ABC"} required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Số tiền *</span>
                <MoneyInput value={form.amount} onValueChange={(raw) => setForm((current) => ({ ...current, amount: raw }))} className="input" placeholder="0" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">{form.type === "THU" ? "Người/đơn vị nộp" : "Người/đơn vị nhận"}</span>
                <input value={form.payee} onChange={(event) => setForm((current) => ({ ...current, payee: event.target.value }))} className="input" maxLength={200} placeholder={form.type === "THU" ? "Nguồn thu (không bắt buộc)" : "Không bắt buộc là nhà cung cấp"} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Phương thức thanh toán</span>
                <select value={form.paymentMethod} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))} className="input">
                  <option value="">— Chọn —</option>
                  {OTHER_EXPENSE_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">{form.type === "THU" ? "Tài khoản nhận tiền" : "Tài khoản chi"}</span>
                <select value={form.companyAccountId} onChange={(event) => setForm((current) => ({ ...current, companyAccountId: event.target.value }))} className="input">
                  <option value="">— Không chọn —</option>
                  {companyAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}{account.isActive ? "" : " (đã khóa)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Số hóa đơn</span>
                <input value={form.invoiceNumber} onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))} className="input" maxLength={100} />
              </label>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-gray-700">Chứng từ</span>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {isUploading ? "Đang tải..." : form.attachmentUrl ? "Đổi chứng từ" : "+ Tải chứng từ"}
                  </button>
                  <input ref={fileInputRef} type="file" accept=".pdf,.xls,.xlsx,.doc,.docx,.png,.jpg,.jpeg" onChange={handleAttachmentChange} className="hidden" />
                  {form.attachmentUrl && (
                    <>
                      <AttachmentPreviewButton url={form.attachmentUrl} name={form.attachmentName} className="max-w-xs truncate text-sm text-blue-600 hover:underline">{form.attachmentName || "Xem chứng từ"}</AttachmentPreviewButton>
                      <button type="button" onClick={() => setForm((current) => ({ ...current, attachmentName: "", attachmentUrl: "" }))} className="text-sm text-red-600 hover:underline">Bỏ tệp</button>
                    </>
                  )}
                </div>
              </div>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
                <textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} rows={3} className="input" maxLength={2000} />
              </label>

              {formError && <p className="text-sm text-red-600 sm:col-span-2">{formError}</p>}

              <div className="flex gap-3 sm:col-span-2">
                <button type="submit" disabled={isSaving || isUploading} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {isSaving ? "Đang lưu..." : "Lưu"}
                </button>
                <button type="button" onClick={() => setEditingExpense(undefined)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className={`rounded-xl border p-4 ${className}`}>
      <p className="text-xs opacity-70">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
