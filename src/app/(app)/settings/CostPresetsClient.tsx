"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COST_CATEGORY_LABELS,
  COST_CATEGORY_OPTIONS,
  isVendorlessCostCategory,
} from "@/lib/shipment-cost-constants";
import VendorCombobox from "@/components/vendors/VendorCombobox";
import MoneyInput from "@/components/MoneyInput";

type Preset = {
  id: string;
  goodsName: string;
  goodsKeyword: string;
  customsGate: string;
  effectiveFrom: string;
  category: string;
  unitPrice: number;
  quantity: number;
  customLabel: string | null;
  unit: string | null;
  paidByUserId: string | null;
  paidFromCompanyAccountId: string | null;
  paidBy: { id: string; name: string } | null;
  paidFromCompanyAccount: { id: string; name: string } | null;
  note: string | null;
  isActive: boolean;
  vendorId: string | null;
  vendor: { id: string; name: string; type: string | null } | null;
};

type NamedOption = { id: string; name: string; isActive?: boolean };

// "Tài khoản chi" gộp thành một chuỗi để dùng 1 dropdown: "company:<id>" | "user:<id>" | "".
function payAccountValue(p: { paidFromCompanyAccountId: string | null; paidByUserId: string | null }) {
  if (p.paidFromCompanyAccountId) return `company:${p.paidFromCompanyAccountId}`;
  if (p.paidByUserId) return `user:${p.paidByUserId}`;
  return "";
}
function splitPayAccount(value: string) {
  if (value.startsWith("company:")) return { paidFromCompanyAccountId: value.slice(8), paidByUserId: null };
  if (value.startsWith("user:")) return { paidFromCompanyAccountId: null, paidByUserId: value.slice(5) };
  return { paidFromCompanyAccountId: null, paidByUserId: null };
}

// effectiveFrom "từ đầu" = mốc 1970 (thời điểm <= 0).
function isEpoch(iso: string) {
  return new Date(iso).getTime() <= 0;
}
function toDateInput(iso: string) {
  return isEpoch(iso) ? "" : new Date(iso).toISOString().slice(0, 10);
}
function effectiveLabel(iso: string) {
  return isEpoch(iso) ? "Từ đầu" : `Từ ${new Date(iso).toLocaleDateString("vi-VN")}`;
}

type Line = {
  key: string;
  id: string;
  category: string;
  customLabel: string;
  unit: string;
  payAccount: string;
  unitPrice: string;
  quantity: string;
  vendorId: string | null;
  vendorName: string;
};

function newLine(category: string = COST_CATEGORY_OPTIONS[0] as string): Line {
  return { key: `l-${crypto.randomUUID()}`, id: "", category, customLabel: "", unit: "", payAccount: "", unitPrice: "", quantity: "1", vendorId: null, vendorName: "" };
}

function emptyForm() {
  return {
    editing: false as boolean,
    goodsName: "",
    customsGate: "",
    effectiveFrom: "",
    lines: [newLine()],
    removedIds: [] as string[],
  };
}

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

function groupKeyOf(p: { goodsKeyword: string; customsGate: string; effectiveFrom: string }) {
  return `${p.goodsKeyword}||${p.customsGate}||${p.effectiveFrom}`;
}

export default function CostPresetsClient() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [companyAccounts, setCompanyAccounts] = useState<NamedOption[]>([]);
  const [users, setUsers] = useState<NamedOption[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadPresets() {
    return fetch("/api/cost-presets")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải bảng giá.");
        setPresets(json.data);
      });
  }

  useEffect(() => {
    loadPresets()
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
    fetch("/api/company-accounts").then((r) => r.json()).then((j) => { if (j.success) setCompanyAccounts(j.data); }).catch(() => {});
    fetch("/api/users").then((r) => r.json()).then((j) => { if (j.success) setUsers(j.data); }).catch(() => {});
  }, []);

  // Gộp bảng giá theo (nhóm hàng, cửa khẩu, mốc thời gian) — mỗi cụm là một mốc giá sửa được cả cụm.
  const groups = useMemo(() => {
    const map = new Map<string, { goodsName: string; goodsKeyword: string; customsGate: string; effectiveFrom: string; items: Preset[] }>();
    for (const p of presets) {
      const key = groupKeyOf(p);
      const g = map.get(key) ?? { goodsName: p.goodsName, goodsKeyword: p.goodsKeyword, customsGate: p.customsGate, effectiveFrom: p.effectiveFrom, items: [] };
      g.items.push(p);
      map.set(key, g);
    }
    return [...map.values()].sort(
      (a, b) =>
        a.goodsName.localeCompare(b.goodsName) ||
        a.customsGate.localeCompare(b.customsGate) ||
        new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
    );
  }, [presets]);

  function updateLine(key: string, patch: Partial<Line>) {
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  }
  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, newLine()] }));
  }
  function removeLine(key: string) {
    setForm((f) => {
      const line = f.lines.find((l) => l.key === key);
      const removedIds = line?.id ? [...f.removedIds, line.id] : f.removedIds;
      const lines = f.lines.filter((l) => l.key !== key);
      return { ...f, lines: lines.length ? lines : [newLine()], removedIds };
    });
  }

  function editGroup(g: (typeof groups)[number]) {
    setMessage(null);
    setError(null);
    setForm({
      editing: true,
      goodsName: g.goodsName,
      customsGate: g.customsGate,
      effectiveFrom: toDateInput(g.effectiveFrom),
      removedIds: [],
      lines: g.items.map((p) => ({
        key: `l-${p.id}`,
        id: p.id,
        category: p.category,
        customLabel: p.customLabel || "",
        unit: p.unit || "",
        payAccount: payAccountValue(p),
        unitPrice: String(p.unitPrice),
        quantity: String(p.quantity),
        vendorId: isVendorlessCostCategory(p.category) ? null : p.vendorId,
        vendorName: isVendorlessCostCategory(p.category) ? "" : p.vendor?.name || "",
      })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteGroup(g: (typeof groups)[number]) {
    if (!confirm(`Xóa mốc "${effectiveLabel(g.effectiveFrom)}" của "${g.goodsName}${g.customsGate ? " · " + g.customsGate : ""}" (${g.items.length} chi phí)? Chi phí đã sinh trên lô hàng vẫn giữ lại.`)) return;
    await Promise.all(g.items.map((p) => fetch(`/api/cost-presets/${p.id}`, { method: "DELETE" })));
    await loadPresets();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!form.goodsName.trim()) return setError("Vui lòng nhập tên/nhóm mặt hàng.");
    const validLines = form.lines.filter((l) => Number(l.unitPrice) > 0);
    if (validLines.length === 0) return setError("Nhập ít nhất một dòng chi phí có đơn giá > 0.");
    // Chặn trùng hạng mục trong cùng một cụm (mỗi hạng mục 1 dòng).
    const cats = validLines.map((l) => l.category);
    if (new Set(cats).size !== cats.length) return setError("Mỗi hạng mục chỉ được một dòng trong cùng mặt hàng + cửa khẩu.");

    setIsSaving(true);
    try {
      for (const id of form.removedIds) {
        await fetch(`/api/cost-presets/${id}`, { method: "DELETE" });
      }
      let matched = 0;
      for (const line of validLines) {
        const payload = {
          goodsName: form.goodsName.trim(),
          customsGate: form.customsGate.trim(),
          effectiveFrom: form.effectiveFrom || null,
          category: line.category,
          customLabel: line.customLabel.trim() || null,
          unit: line.unit.trim() || null,
          ...splitPayAccount(line.payAccount),
          unitPrice: line.unitPrice,
          quantity: Number(line.quantity) || 1,
          vendorId: isVendorlessCostCategory(line.category) ? null : line.vendorId,
        };
        const res = await fetch(line.id ? `/api/cost-presets/${line.id}` : "/api/cost-presets", {
          method: line.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Không thể lưu một dòng chi phí.");
        matched = json.data.matchedShipments ?? matched;
      }
      setMessage(`Đã lưu ${validLines.length} chi phí và áp cho ${matched} lô có tờ khai khớp.`);
      setForm(emptyForm());
      await loadPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSaving(false);
    }
  }

  const formTotal = form.lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Cài đặt chi phí mặt hàng</h1>
        <p className="mt-1 text-sm text-gray-500">
          Chọn mặt hàng + cửa khẩu, nhập các chi phí cố định. Khi lô hàng có tờ khai, hệ thống tự thêm đúng bộ chi phí theo
          nhóm hàng và cửa khẩu của lô (cửa khẩu để trống = áp cho mọi cửa khẩu).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Tên/nhóm mặt hàng</span>
            <input
              value={form.goodsName}
              onChange={(e) => setForm((f) => ({ ...f, goodsName: e.target.value }))}
              className="input"
              placeholder="VD: Máy nghiền đá cũ"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Cửa khẩu</span>
            <input
              value={form.customsGate}
              onChange={(e) => setForm((f) => ({ ...f, customsGate: e.target.value }))}
              className="input"
              placeholder="VD: Trà Lĩnh — để trống = mọi cửa khẩu"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Áp dụng từ ngày</span>
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
              className="input"
            />
            <span className="mt-1 block text-xs text-gray-400">Để trống = áp từ đầu. Đổi giá thì thêm mốc mới.</span>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[1080px] w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Hạng mục</th>
                <th className="px-3 py-2 font-medium">Nhãn tùy chọn</th>
                <th className="px-3 py-2 font-medium">Nhà cung cấp</th>
                <th className="px-3 py-2 font-medium">ĐVT</th>
                <th className="px-3 py-2 font-medium">Tài khoản chi</th>
                <th className="px-3 py-2 font-medium">Đơn giá</th>
                <th className="px-3 py-2 font-medium">SL</th>
                <th className="px-3 py-2 font-medium text-right">Thành tiền</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {form.lines.map((line) => {
                const lineTotal = (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0);
                return (
                  <tr key={line.key}>
                    <td className="px-3 py-2">
                      <select value={line.category} onChange={(e) => updateLine(line.key, { category: e.target.value, ...(isVendorlessCostCategory(e.target.value) ? { vendorId: null, vendorName: "" } : {}) })} className="input min-w-32">
                        {COST_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{COST_CATEGORY_LABELS[c]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input value={line.customLabel} onChange={(e) => updateLine(line.key, { customLabel: e.target.value })} className="input min-w-40" placeholder="VD: Lái xe chuyên trách" />
                    </td>
                    <td className="px-3 py-2">
                      {isVendorlessCostCategory(line.category) ? (
                        <span className="text-xs text-gray-400">Không áp dụng</span>
                      ) : (
                        <VendorCombobox vendorName={line.vendorName} vendorId={line.vendorId} onChange={({ vendorName, vendorId }) => updateLine(line.key, { vendorName, vendorId })} />
                      )}
                    </td>
                    <td className="px-3 py-2"><input value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value })} className="input w-20" placeholder="lần, xe" /></td>
                    <td className="px-3 py-2">
                      <select value={line.payAccount} onChange={(e) => updateLine(line.key, { payAccount: e.target.value })} className="input min-w-36">
                        <option value="">— Chọn TK —</option>
                        {companyAccounts.length > 0 && <optgroup label="Tài khoản công ty">{companyAccounts.map((a) => <option key={a.id} value={`company:${a.id}`}>{a.name}</option>)}</optgroup>}
                        {users.length > 0 && <optgroup label="Cá nhân">{users.map((u) => <option key={u.id} value={`user:${u.id}`}>{u.name}</option>)}</optgroup>}
                      </select>
                    </td>
                    <td className="px-3 py-2"><MoneyInput value={line.unitPrice} onValueChange={(raw) => updateLine(line.key, { unitPrice: raw })} className="input w-32" /></td>
                    <td className="px-3 py-2"><input type="number" min="0.01" step="any" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} className="input w-16" /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-gray-900">{formatVnd(lineTotal)}</td>
                    <td className="px-3 py-2"><button type="button" onClick={() => removeLine(line.key)} className="text-red-600 hover:underline">Xóa</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={7} className="px-3 py-2 text-right text-sm font-medium text-gray-600">Tổng chi phí cố định</td>
                <td className="px-3 py-2 text-right font-bold text-blue-700">{formatVnd(formTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={addLine} className="rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50">+ Thêm dòng chi phí</button>
          <button type="submit" disabled={isSaving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {isSaving ? "Đang lưu..." : form.editing ? "Lưu thay đổi" : "Lưu tất cả"}
          </button>
          {form.editing && <button type="button" onClick={() => setForm(emptyForm())} className="text-sm text-gray-500 hover:underline">Hủy sửa</button>}
          {message && <span className="text-sm text-green-700">{message}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <div className="space-y-4">
        {isLoading && <p className="text-center text-gray-400">Đang tải...</p>}
        {!isLoading && groups.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-400">Chưa có cấu hình giá.</p>}
        {groups.map((g) => {
          const total = g.items.reduce((s, p) => s + p.unitPrice * p.quantity, 0);
          return (
            <div key={groupKeyOf(g)} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3">
                <div>
                  <span className="font-semibold text-gray-900">{g.goodsName}</span>
                  <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                    {g.customsGate ? g.customsGate : "Mọi cửa khẩu"}
                  </span>
                  <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                    {effectiveLabel(g.effectiveFrom)}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">nhóm hàng: {g.goodsKeyword}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-blue-700">Tổng {formatVnd(total)}</span>
                  <button type="button" onClick={() => editGroup(g)} className="text-sm text-blue-600 hover:underline">Sửa</button>
                  <button type="button" onClick={() => deleteGroup(g)} className="text-sm text-red-600 hover:underline">Xóa</button>
                </div>
              </div>
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <tbody className="divide-y divide-gray-100">
                  {g.items.map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-2 text-gray-800">{p.customLabel || COST_CATEGORY_LABELS[p.category]}</td>
                      <td className="px-5 py-2 text-gray-500">{COST_CATEGORY_LABELS[p.category]}</td>
                      <td className="px-5 py-2 text-gray-600">{isVendorlessCostCategory(p.category) ? "" : p.vendor?.name || <span className="text-amber-600">Chưa gắn NCC</span>}</td>
                      <td className="px-5 py-2 text-gray-600">{p.paidFromCompanyAccount?.name || p.paidBy?.name || <span className="text-gray-300">—</span>}</td>
                      <td className="px-5 py-2 text-gray-600">{formatVnd(p.unitPrice)} × {p.quantity}{p.unit ? ` ${p.unit}` : ""}</td>
                      <td className="px-5 py-2 text-right font-medium text-gray-900">{formatVnd(p.unitPrice * p.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
