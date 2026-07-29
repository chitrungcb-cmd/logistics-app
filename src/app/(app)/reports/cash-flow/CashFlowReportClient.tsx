"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MoneyInput from "@/components/MoneyInput";
import { computeCashFlowTotals } from "@/lib/cash-flow-report";

type ShipmentRef = {
  id: string;
  declarationNo: string | null;
  declarationDate: string | null;
  goodsName: string | null;
  customerName: string;
};

type Account = {
  id: string;
  name: string;
  isActive?: boolean;
  thu: number;
  chi: number;
  balance: number;
  chiCount: number;
  thuCount: number;
  transferIn: number;
  transferOut: number;
  transferInCount: number;
  transferOutCount: number;
};

type Transfer = {
  id: string;
  transferDate: string;
  amount: number;
  note: string | null;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
  shipment: ShipmentRef | null;
};

type Report = {
  companyAccounts: Account[];
  persons: Account[];
  unassignedChi: { amount: number; count: number };
  unassignedThu: { amount: number; count: number };
  transfers: Transfer[];
  shipmentOptions: ShipmentRef[];
};

type LedgerEntry = {
  id: string;
  type: "EXPENSE" | "RECEIPT" | "TRANSFER_IN" | "TRANSFER_OUT";
  date: string;
  amount: number;
  label: string;
  counterparty: string | null;
  invoiceNumber: string | null;
  note: string | null;
  shipment: ShipmentRef | null;
};

type Detail = {
  person: { id: string; name: string };
  entries: LedgerEntry[];
};

type LedgerFilter = "ALL" | "RECEIPT" | "EXPENSE" | "TRANSFER";

function formatVnd(n: number) {
  return Math.round(n).toLocaleString("vi-VN") + " đ";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN");
}

function todayInputValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function Balance({ value }: { value: number }) {
  return <span className={value >= 0 ? "text-blue-700" : "text-orange-700"}>{formatVnd(value)}</span>;
}

function ShipmentSummary({ shipment }: { shipment: ShipmentRef | null }) {
  if (!shipment) return <span className="text-gray-400">Không gắn lô hàng</span>;
  return (
    <div className="min-w-0">
      <p className="font-medium text-blue-700">TK {shipment.declarationNo || "chưa có số"}</p>
      <p className="truncate text-xs text-gray-600">
        {formatDate(shipment.declarationDate)} · {shipment.goodsName || "Chưa có tên hàng"}
      </p>
      <p className="truncate text-xs text-gray-400">{shipment.customerName}</p>
    </div>
  );
}

export default function CashFlowReportClient({
  canManageAccounts,
  canManageTransfers,
}: {
  canManageAccounts: boolean;
  canManageTransfers: boolean;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("ALL");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [showTransferModal, setShowTransferModal] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/reports/cash-flow")
      .then((response) => response.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải báo cáo.");
        setReport(json.data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Đã có lỗi."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openPersonLedger = useCallback(async (personId: string) => {
    setSelectedPersonId(personId);
    setLedgerFilter("ALL");
    setLedgerSearch("");
    setDetail(null);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/reports/cash-flow/details?personId=${encodeURIComponent(personId)}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải sổ chi tiết.");
      setDetail(json.data);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Không thể tải sổ chi tiết.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function addAccount() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const response = await fetch("/api/company-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể thêm tài khoản.");
      setNewName("");
      await load();
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "Đã có lỗi.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAccount(id: string, isActive: boolean) {
    await fetch(`/api/company-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    await load();
  }

  async function handleTransferSaved(personIds: string[]) {
    setShowTransferModal(false);
    await load();
    if (selectedPersonId && personIds.includes(selectedPersonId)) {
      await openPersonLedger(selectedPersonId);
    }
  }

  const totals = report ? computeCashFlowTotals(report) : { thu: 0, chi: 0, balance: 0 };
  const activePersons = report?.persons.filter(
    (person) =>
      person.thu > 0 ||
      person.chi > 0 ||
      person.transferIn > 0 ||
      person.transferOut > 0
  ) ?? [];

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sổ thu – chi theo người và tài khoản</h1>
          <p className="mt-1 text-sm text-gray-500">
            Theo dõi rõ ai nhận tiền, ai chi hộ cho lô nào và các khoản chuyển nội bộ giữa từng cá nhân.
          </p>
        </div>
        <Link href="/reports" className="shrink-0 text-sm text-blue-600 hover:underline">← Báo cáo</Link>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-gray-400">Đang tải...</p>
      ) : error && !report ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : report ? (
        <>
          {error && (
            <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} className="font-medium">Đóng</button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Tổng tiền đã nhận" value={totals.thu} tone="green" />
            <SummaryCard label="Tổng tiền đã chi" value={totals.chi} tone="red" />
            <SummaryCard label="Chênh lệch thu – chi" value={totals.balance} tone={totals.balance >= 0 ? "blue" : "orange"} />
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">Tài khoản công ty</h2>
                <p className="mt-0.5 text-xs text-gray-500">Tiền vào và tiền chi trực tiếp từ các tài khoản ngân hàng công ty.</p>
              </div>
              {canManageAccounts && (
                <div className="flex gap-2">
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && addAccount()}
                    className="input w-64"
                    placeholder="Tên tài khoản công ty"
                  />
                  <button type="button" onClick={addAccount} disabled={busy || !newName.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    + Thêm tài khoản
                  </button>
                </div>
              )}
            </div>
            <CompanyAccountTable
              rows={report.companyAccounts}
              onToggle={canManageAccounts ? toggleAccount : undefined}
              showToggle={canManageAccounts}
            />
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">Tổng hợp theo cá nhân</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  Chuyển nội bộ chỉ điều chuyển số dư giữa hai người, không cộng vào tổng thu hoặc tổng chi công ty.
                </p>
              </div>
              {canManageTransfers && (
                <button type="button" onClick={() => setShowTransferModal(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  + Ghi nhận chuyển nội bộ
                </button>
              )}
            </div>
            <PersonTable
              rows={activePersons}
              selectedPersonId={selectedPersonId}
              onOpen={openPersonLedger}
            />
          </section>

          {selectedPersonId && (
            <PersonLedger
              account={report.persons.find((person) => person.id === selectedPersonId) ?? null}
              detail={detail}
              loading={detailLoading}
              filter={ledgerFilter}
              search={ledgerSearch}
              onFilterChange={setLedgerFilter}
              onSearchChange={setLedgerSearch}
              onClose={() => {
                setSelectedPersonId(null);
                setDetail(null);
              }}
            />
          )}

          <TransferLedger transfers={report.transfers} onAdd={canManageTransfers ? () => setShowTransferModal(true) : undefined} />

          {(report.unassignedChi.count > 0 || report.unassignedThu.count > 0) && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {report.unassignedChi.count > 0 && (
                <p>⚠ {report.unassignedChi.count} khoản chi ({formatVnd(report.unassignedChi.amount)}) <b>chưa xác định người hoặc tài khoản đã chi</b>.</p>
              )}
              {report.unassignedThu.count > 0 && (
                <p>⚠ {report.unassignedThu.count} khoản nhận ({formatVnd(report.unassignedThu.amount)}) <b>chưa xác định người hoặc tài khoản nhận tiền</b>.</p>
              )}
            </div>
          )}

          {showTransferModal && (
            <TransferModal
              persons={report.persons}
              shipmentOptions={report.shipmentOptions}
              onClose={() => setShowTransferModal(false)}
              onSaved={handleTransferSaved}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "green" | "red" | "blue" | "orange" }) {
  const tones = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    red: "border-red-200 bg-red-50 text-red-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    orange: "border-orange-200 bg-orange-50 text-orange-800",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold">{formatVnd(value)}</p>
    </div>
  );
}

function CompanyAccountTable({
  rows,
  onToggle,
  showToggle,
}: {
  rows: Account[];
  onToggle?: (id: string, isActive: boolean) => void;
  showToggle?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2">Tài khoản</th>
            <th className="py-2 text-right">Đã nhận</th>
            <th className="py-2 text-right">Đã chi</th>
            <th className="py-2 text-right">Chênh lệch</th>
            {showToggle && <th className="py-2 text-right">Trạng thái</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr><td colSpan={showToggle ? 5 : 4} className="py-6 text-center text-gray-400">Chưa có tài khoản công ty.</td></tr>
          )}
          {rows.map((account) => (
            <tr key={account.id} className={account.isActive === false ? "opacity-50" : ""}>
              <td className="py-2 font-medium text-gray-900">{account.name}</td>
              <td className="py-2 text-right font-medium text-emerald-700">{account.thu > 0 ? formatVnd(account.thu) : <span className="text-gray-300">—</span>}</td>
              <td className="py-2 text-right font-medium text-red-700">{account.chi > 0 ? formatVnd(account.chi) : <span className="text-gray-300">—</span>}</td>
              <td className="py-2 text-right font-semibold"><Balance value={account.balance} /></td>
              {showToggle && onToggle && (
                <td className="py-2 text-right">
                  <button type="button" onClick={() => onToggle(account.id, account.isActive !== false)} className="text-xs text-blue-600 hover:underline">
                    {account.isActive !== false ? "Đang dùng · Tắt" : "Đã tắt · Bật"}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonTable({
  rows,
  selectedPersonId,
  onOpen,
}: {
  rows: Account[];
  selectedPersonId: string | null;
  onOpen: (personId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2">Cá nhân</th>
            <th className="py-2 text-right">Nhận từ lô hàng</th>
            <th className="py-2 text-right">Chi cho lô hàng</th>
            <th className="py-2 text-right">Nhận nội bộ</th>
            <th className="py-2 text-right">Chuyển nội bộ</th>
            <th className="py-2 text-right">Số dư đang giữ</th>
            <th className="py-2 text-right">Chi tiết</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-gray-400">Chưa có giao dịch nào gắn với cá nhân.</td></tr>
          )}
          {rows.map((person) => (
            <tr key={person.id} className={selectedPersonId === person.id ? "bg-blue-50/70" : ""}>
              <td className="py-3 font-semibold text-gray-900">{person.name}</td>
              <td className="py-3 text-right">
                <p className="font-medium text-emerald-700">{person.thu ? formatVnd(person.thu) : "—"}</p>
                {person.thuCount > 0 && <p className="text-xs text-gray-400">{person.thuCount} khoản</p>}
              </td>
              <td className="py-3 text-right">
                <p className="font-medium text-red-700">{person.chi ? formatVnd(person.chi) : "—"}</p>
                {person.chiCount > 0 && <p className="text-xs text-gray-400">{person.chiCount} khoản</p>}
              </td>
              <td className="py-3 text-right">
                <p className="font-medium text-emerald-700">{person.transferIn ? formatVnd(person.transferIn) : "—"}</p>
                {person.transferInCount > 0 && <p className="text-xs text-gray-400">{person.transferInCount} lần</p>}
              </td>
              <td className="py-3 text-right">
                <p className="font-medium text-orange-700">{person.transferOut ? formatVnd(person.transferOut) : "—"}</p>
                {person.transferOutCount > 0 && <p className="text-xs text-gray-400">{person.transferOutCount} lần</p>}
              </td>
              <td className="py-3 text-right font-semibold"><Balance value={person.balance} /></td>
              <td className="py-3 text-right">
                <button type="button" onClick={() => onOpen(person.id)} className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
                  Xem sổ chi tiết
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonLedger({
  account,
  detail,
  loading,
  filter,
  search,
  onFilterChange,
  onSearchChange,
  onClose,
}: {
  account: Account | null;
  detail: Detail | null;
  loading: boolean;
  filter: LedgerFilter;
  search: string;
  onFilterChange: (filter: LedgerFilter) => void;
  onSearchChange: (search: string) => void;
  onClose: () => void;
}) {
  const entries = useMemo(() => {
    if (!detail) return [];
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");
    return detail.entries.filter((entry) => {
      const matchesType =
        filter === "ALL" ||
        (filter === "RECEIPT" && entry.type === "RECEIPT") ||
        (filter === "EXPENSE" && entry.type === "EXPENSE") ||
        (filter === "TRANSFER" && entry.type.startsWith("TRANSFER"));
      if (!matchesType) return false;
      if (!normalizedSearch) return true;
      return [
        entry.label,
        entry.counterparty,
        entry.invoiceNumber,
        entry.note,
        entry.shipment?.declarationNo,
        entry.shipment?.goodsName,
        entry.shipment?.customerName,
      ].some((value) => value?.toLocaleLowerCase("vi").includes(normalizedSearch));
    });
  }, [detail, filter, search]);

  return (
    <section className="rounded-xl border-2 border-blue-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Sổ chi tiết cá nhân</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">{account?.name || detail?.person.name || "Cá nhân"}</h2>
          {account && (
            <p className="mt-1 text-sm text-gray-500">
              Đã nhận {formatVnd(account.thu)} + nhận nội bộ {formatVnd(account.transferIn)} − đã chi {formatVnd(account.chi)} − chuyển nội bộ {formatVnd(account.transferOut)}
              {" = "}<b className="text-gray-900">{formatVnd(account.balance)}</b>
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Đóng</button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {([
          ["ALL", "Tất cả"],
          ["RECEIPT", "Đã nhận"],
          ["EXPENSE", "Đã chi"],
          ["TRANSFER", "Chuyển nội bộ"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilterChange(value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === value ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {label}
          </button>
        ))}
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="input ml-auto min-w-64"
          placeholder="Tìm số tờ khai, tên hàng, khách hàng..."
        />
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-gray-400">Đang tải sổ chi tiết...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2">Ngày</th>
                <th className="px-3 py-2">Loại giao dịch</th>
                <th className="px-3 py-2">Nội dung</th>
                <th className="px-3 py-2">Lô hàng liên quan</th>
                <th className="px-3 py-2">Đối tượng</th>
                <th className="px-3 py-2 text-right">Tiền vào</th>
                <th className="px-3 py-2 text-right">Tiền ra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400">Không có giao dịch phù hợp.</td></tr>
              )}
              {entries.map((entry) => {
                const isIncoming = entry.type === "RECEIPT" || entry.type === "TRANSFER_IN";
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600">{formatDate(entry.date)}</td>
                    <td className="px-3 py-3"><TransactionBadge type={entry.type} /></td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-gray-900">{entry.label}</p>
                      {entry.invoiceNumber && <p className="text-xs text-gray-500">HĐ: {entry.invoiceNumber}</p>}
                      {entry.note && <p className="mt-0.5 text-xs text-gray-400">{entry.note}</p>}
                    </td>
                    <td className="max-w-xs px-3 py-3"><ShipmentSummary shipment={entry.shipment} /></td>
                    <td className="max-w-56 px-3 py-3 text-gray-600">{entry.counterparty || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-emerald-700">{isIncoming ? formatVnd(entry.amount) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-red-700">{!isIncoming ? formatVnd(entry.amount) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TransactionBadge({ type }: { type: LedgerEntry["type"] }) {
  const config = {
    RECEIPT: ["Đã nhận", "bg-emerald-100 text-emerald-700"],
    EXPENSE: ["Đã chi", "bg-red-100 text-red-700"],
    TRANSFER_IN: ["Nhận nội bộ", "bg-blue-100 text-blue-700"],
    TRANSFER_OUT: ["Chuyển nội bộ", "bg-orange-100 text-orange-700"],
  } as const;
  const [label, className] = config[type];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{label}</span>;
}

function TransferLedger({ transfers, onAdd }: { transfers: Transfer[]; onAdd?: () => void }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">Chuyển nội bộ giữa cá nhân</h2>
          <p className="mt-0.5 text-xs text-gray-500">Một dòng duy nhất thể hiện rõ ai chuyển, ai nhận và lô hàng liên quan.</p>
        </div>
        {onAdd && (
          <button type="button" onClick={onAdd} className="rounded-md border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50">+ Thêm</button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2">Ngày chuyển</th>
              <th className="px-3 py-2">Người chuyển</th>
              <th className="px-3 py-2">Người nhận</th>
              <th className="px-3 py-2">Lô hàng liên quan</th>
              <th className="px-3 py-2">Ghi chú</th>
              <th className="px-3 py-2 text-right">Số tiền</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {transfers.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">Chưa có khoản chuyển nội bộ nào.</td></tr>
            )}
            {transfers.map((transfer) => (
              <tr key={transfer.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 text-gray-600">{formatDate(transfer.transferDate)}</td>
                <td className="px-3 py-3 font-medium text-orange-700">{transfer.fromUser.name}</td>
                <td className="px-3 py-3 font-medium text-blue-700">{transfer.toUser.name}</td>
                <td className="max-w-xs px-3 py-3"><ShipmentSummary shipment={transfer.shipment} /></td>
                <td className="max-w-64 px-3 py-3 text-gray-500">{transfer.note || "—"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">{formatVnd(transfer.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TransferModal({
  persons,
  shipmentOptions,
  onClose,
  onSaved,
}: {
  persons: Account[];
  shipmentOptions: ShipmentRef[];
  onClose: () => void;
  onSaved: (personIds: string[]) => void;
}) {
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [transferDate, setTransferDate] = useState(todayInputValue());
  const [shipmentId, setShipmentId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/reports/cash-flow/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId, toUserId, amount, transferDate, shipmentId, note }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu khoản chuyển.");
      await onSaved([fromUserId, toUserId]);
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Không thể lưu khoản chuyển.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Ghi nhận chuyển nội bộ</h2>
            <p className="mt-1 text-sm text-gray-500">Ghi đúng một dòng chuyển từ người giữ tiền sang người nhận tiền.</p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>

        {formError && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Người chuyển</span>
            <select value={fromUserId} onChange={(event) => setFromUserId(event.target.value)} className="input" required>
              <option value="">Chọn người chuyển</option>
              {persons.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Người nhận</span>
            <select value={toUserId} onChange={(event) => setToUserId(event.target.value)} className="input" required>
              <option value="">Chọn người nhận</option>
              {persons.filter((person) => person.id !== fromUserId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Số tiền</span>
            <MoneyInput value={amount} onValueChange={setAmount} className="input" placeholder="0" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Ngày chuyển</span>
            <input type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} className="input" required />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Lô hàng liên quan <span className="font-normal text-gray-400">(không bắt buộc)</span></span>
          <select value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} className="input">
            <option value="">Không gắn lô hàng</option>
            {shipmentOptions.map((shipment) => (
              <option key={shipment.id} value={shipment.id}>
                TK {shipment.declarationNo || "chưa có số"} · {shipment.goodsName || "Chưa có tên hàng"} · {shipment.customerName}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} className="input min-h-20" placeholder="Lý do chuyển hoặc nội dung cần ghi nhớ" />
        </label>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Hủy</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Đang lưu..." : "Lưu chuyển nội bộ"}
          </button>
        </div>
      </form>
    </div>
  );
}
