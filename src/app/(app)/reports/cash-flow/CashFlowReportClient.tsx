"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MoneyInput from "@/components/MoneyInput";
import AttachmentPreviewButton from "@/components/shipments/AttachmentPreviewButton";
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
  type: "ADVANCE" | "RETURN";
  transferDate: string;
  amount: number;
  note: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  createdAt: string;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
  createdBy: { id: string; name: string } | null;
};

type Report = {
  companyAccounts: Account[];
  persons: Account[];
  unassignedChi: { amount: number; count: number };
  unassignedThu: { amount: number; count: number };
  transfers: Transfer[];
  period: { from: string; to: string } | null;
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
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  recordedBy?: string | null;
  recordedAt?: string | null;
  shipment: ShipmentRef | null;
};

type Detail = {
  person: { id: string; name: string };
  entries: LedgerEntry[];
  shipmentCosts: ShipmentCostDetail[];
};

type ShipmentCostDetail = {
  id: string;
  shipmentId: string;
  label: string;
  amount: number;
  invoiceNumber: string | null;
  vendorName: string | null;
  payerId: string | null;
  payerName: string | null;
  payerType: "PERSON" | "COMPANY" | null;
  note: string | null;
};

type ShipmentExpenseGroup = {
  shipment: ShipmentRef;
  personAmount: number;
  personCostCount: number;
  totalAmount: number;
  totalCostCount: number;
};

type LedgerFilter = "ALL" | "RECEIPT" | "EXPENSE" | "TRANSFER";
type PeriodMode = "ALL" | "DAY" | "MONTH" | "QUARTER" | "YEAR";

type PeriodSelection = {
  from: string;
  to: string;
  label: string;
};

function formatVnd(n: number) {
  return Math.round(n).toLocaleString("vi-VN") + " đ";
}

function formatSignedVnd(n: number) {
  const roundedValue = Math.round(n);
  if (roundedValue > 0) return `+${roundedValue.toLocaleString("vi-VN")} đ`;
  return `${roundedValue.toLocaleString("vi-VN")} đ`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN");
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayInputValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function currentMonthInputValue() {
  return todayInputValue().slice(0, 7);
}

function inputDate(year: number, month: number, day: number) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function formatInputDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function buildPeriodSelection({
  mode,
  day,
  month,
  quarter,
  year,
}: {
  mode: PeriodMode;
  day: string;
  month: string;
  quarter: number;
  year: number;
}): PeriodSelection | null {
  if (mode === "ALL") return null;
  if (mode === "DAY") return { from: day, to: day, label: `Ngày ${formatInputDate(day)}` };

  if (mode === "MONTH") {
    const [selectedYear, selectedMonth] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate();
    return {
      from: inputDate(selectedYear, selectedMonth, 1),
      to: inputDate(selectedYear, selectedMonth, lastDay),
      label: `Tháng ${selectedMonth}/${selectedYear}`,
    };
  }

  if (mode === "QUARTER") {
    const firstMonth = (quarter - 1) * 3 + 1;
    const lastMonth = firstMonth + 2;
    const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
    return {
      from: inputDate(year, firstMonth, 1),
      to: inputDate(year, lastMonth, lastDay),
      label: `Quý ${quarter}/${year}`,
    };
  }

  return {
    from: inputDate(year, 1, 1),
    to: inputDate(year, 12, 31),
    label: `Năm ${year}`,
  };
}

function Balance({ value }: { value: number }) {
  return <span className={value >= 0 ? "text-blue-700" : "text-orange-700"}>{formatVnd(value)}</span>;
}

function PersonalSettlementStatus({ value, compact = false }: { value: number; compact?: boolean }) {
  const roundedValue = Math.round(value);
  const tone = roundedValue === 0
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : roundedValue > 0
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : "border-orange-200 bg-orange-50 text-orange-800";
  return (
    <div className={`rounded-lg border ${tone} ${compact ? "px-3 py-2" : "p-4"}`}>
      {!compact && <p className="text-xs font-medium opacity-75">Số dư đối soát</p>}
      <p className={`${compact ? "text-sm" : "mt-1 text-xl"} font-bold`}>{formatSignedVnd(roundedValue)}</p>
    </div>
  );
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
  const [periodMode, setPeriodMode] = useState<PeriodMode>("ALL");
  const [periodDay, setPeriodDay] = useState(todayInputValue());
  const [periodMonth, setPeriodMonth] = useState(currentMonthInputValue());
  const [periodQuarter, setPeriodQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());

  const periodSelection = useMemo(
    () => buildPeriodSelection({
      mode: periodMode,
      day: periodDay,
      month: periodMonth,
      quarter: periodQuarter,
      year: periodYear,
    }),
    [periodDay, periodMode, periodMonth, periodQuarter, periodYear]
  );
  const periodQuery = periodSelection
    ? new URLSearchParams({
        dateFrom: periodSelection.from,
        dateTo: periodSelection.to,
      }).toString()
    : "";

  const load = useCallback(() => {
    const url = `/api/reports/cash-flow${periodQuery ? `?${periodQuery}` : ""}`;
    return fetch(url)
      .then((response) => response.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải báo cáo.");
        setReport(json.data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Đã có lỗi."))
      .finally(() => setIsLoading(false));
  }, [periodQuery]);

  useEffect(() => {
    load();
  }, [load]);

  function preparePeriodChange() {
    setIsLoading(true);
    setError(null);
    setSelectedPersonId(null);
    setDetail(null);
  }

  const openPersonLedger = useCallback(async (personId: string) => {
    setSelectedPersonId(personId);
    setLedgerFilter("ALL");
    setLedgerSearch("");
    setDetail(null);
    setDetailLoading(true);
    try {
      const detailParams = new URLSearchParams({ personId });
      if (periodSelection) {
        detailParams.set("dateFrom", periodSelection.from);
        detailParams.set("dateTo", periodSelection.to);
      }
      const response = await fetch(`/api/reports/cash-flow/details?${detailParams.toString()}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải sổ chi tiết.");
      setDetail(json.data);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Không thể tải sổ chi tiết.");
    } finally {
      setDetailLoading(false);
    }
  }, [periodSelection]);

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

      <PeriodFilter
        mode={periodMode}
        day={periodDay}
        month={periodMonth}
        quarter={periodQuarter}
        year={periodYear}
        selection={periodSelection}
        onModeChange={(value) => {
          preparePeriodChange();
          setPeriodMode(value);
        }}
        onDayChange={(value) => {
          preparePeriodChange();
          setPeriodDay(value);
        }}
        onMonthChange={(value) => {
          preparePeriodChange();
          setPeriodMonth(value);
        }}
        onQuarterChange={(value) => {
          preparePeriodChange();
          setPeriodQuarter(value);
        }}
        onYearChange={(value) => {
          preparePeriodChange();
          setPeriodYear(value);
        }}
      />

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
                  Đối soát = tiền cá nhân nhận + nhận nội bộ − tiền đã chi − tiền chuyển nội bộ. Kết quả chỉ hiển thị số dư dương (+), âm (−) hoặc 0.
                </p>
              </div>
              {canManageTransfers && (
                <button type="button" onClick={() => setShowTransferModal(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  + Ghi nhận tạm ứng/hoàn ứng
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
              onClose={() => setShowTransferModal(false)}
              onSaved={handleTransferSaved}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function PeriodFilter({
  mode,
  day,
  month,
  quarter,
  year,
  selection,
  onModeChange,
  onDayChange,
  onMonthChange,
  onQuarterChange,
  onYearChange,
}: {
  mode: PeriodMode;
  day: string;
  month: string;
  quarter: number;
  year: number;
  selection: PeriodSelection | null;
  onModeChange: (mode: PeriodMode) => void;
  onDayChange: (day: string) => void;
  onMonthChange: (month: string) => void;
  onQuarterChange: (quarter: number) => void;
  onYearChange: (year: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 16 }, (_, index) => currentYear + 1 - index);
  const modes: Array<{ value: PeriodMode; label: string }> = [
    { value: "ALL", label: "Toàn bộ" },
    { value: "DAY", label: "Theo ngày" },
    { value: "MONTH", label: "Theo tháng" },
    { value: "QUARTER", label: "Theo quý" },
    { value: "YEAR", label: "Theo năm" },
  ];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h2 className="text-sm font-semibold text-gray-900">Kỳ tra cứu</h2>
          <p className="text-xs text-gray-500">Lọc đồng thời toàn bộ số thu, chi và tạm/hoàn ứng.</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
          {modes.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onModeChange(item.value)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === item.value
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === "DAY" && (
          <input
            type="date"
            value={day}
            onChange={(event) => event.target.value && onDayChange(event.target.value)}
            className="input w-auto min-w-44"
          />
        )}
        {mode === "MONTH" && (
          <input
            type="month"
            value={month}
            onChange={(event) => event.target.value && onMonthChange(event.target.value)}
            className="input w-auto min-w-44"
          />
        )}
        {mode === "QUARTER" && (
          <>
            <select
              value={quarter}
              onChange={(event) => onQuarterChange(Number(event.target.value))}
              className="input w-auto min-w-32"
            >
              {[1, 2, 3, 4].map((item) => <option key={item} value={item}>Quý {item}</option>)}
            </select>
            <select
              value={year}
              onChange={(event) => onYearChange(Number(event.target.value))}
              className="input w-auto min-w-28"
            >
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </>
        )}
        {mode === "YEAR" && (
          <select
            value={year}
            onChange={(event) => onYearChange(Number(event.target.value))}
            className="input w-auto min-w-32"
          >
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        )}

        <span className="ml-auto rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
          {selection?.label || "Tất cả thời gian"}
        </span>
      </div>
    </section>
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
            <th className="py-2 text-right">Nhận tạm/hoàn ứng</th>
            <th className="py-2 text-right">Đã tạm/hoàn ứng</th>
            <th className="py-2 text-right">Kết quả đối soát</th>
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
              <td className="py-3 pl-4 text-right">
                <PersonalSettlementStatus value={person.balance} compact />
              </td>
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
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
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

  const expenseGroups = useMemo<ShipmentExpenseGroup[]>(() => {
    if (!detail) return [];
    const groups = new Map<string, ShipmentExpenseGroup>();
    for (const entry of detail.entries) {
      if (entry.type !== "EXPENSE" || !entry.shipment) continue;
      const current = groups.get(entry.shipment.id) ?? {
        shipment: entry.shipment,
        personAmount: 0,
        personCostCount: 0,
        totalAmount: 0,
        totalCostCount: 0,
      };
      current.personAmount += entry.amount;
      current.personCostCount += 1;
      groups.set(entry.shipment.id, current);
    }
    for (const cost of detail.shipmentCosts) {
      const current = groups.get(cost.shipmentId);
      if (!current) continue;
      current.totalAmount += cost.amount;
      current.totalCostCount += 1;
    }
    return [...groups.values()].sort((a, b) => {
      const dateDifference =
        new Date(b.shipment.declarationDate ?? 0).getTime() -
        new Date(a.shipment.declarationDate ?? 0).getTime();
      return dateDifference || b.personAmount - a.personAmount;
    });
  }, [detail]);

  const selectedExpenseGroup = expenseGroups.find(
    (group) => group.shipment.id === selectedShipmentId
  ) ?? null;

  return (
    <section className="rounded-xl border-2 border-blue-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Sổ chi tiết cá nhân</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">{account?.name || detail?.person.name || "Cá nhân"}</h2>
          {account && (
            <p className="mt-1 text-sm text-gray-500">
              Đã nhận {formatVnd(account.thu)} + nhận nội bộ {formatVnd(account.transferIn)} − đã chi {formatVnd(account.chi)} − chuyển nội bộ {formatVnd(account.transferOut)}
              {" = "}<b className="text-gray-900">{formatSignedVnd(account.balance)}</b>
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Đóng</button>
      </div>

      {account && (
        <div className="mb-4 max-w-lg">
          <PersonalSettlementStatus value={account.balance} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {([
          ["ALL", "Tất cả"],
          ["RECEIPT", "Đã nhận"],
          ["EXPENSE", "Đã chi"],
          ["TRANSFER", "Tạm ứng/hoàn ứng"],
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
        <>
          <div className="mb-5 overflow-x-auto rounded-lg border border-blue-200">
            <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
              <h3 className="font-semibold text-gray-900">Các lô cá nhân đã chi</h3>
              <p className="mt-0.5 text-xs text-gray-500">Mỗi lô một dòng; tổng chi lô bao gồm tất cả người và tài khoản công ty đã chi.</p>
            </div>
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-center">STT</th>
                  <th className="px-3 py-2">Số TK / ngày TK</th>
                  <th className="px-3 py-2">Tên hàng / khách hàng</th>
                  <th className="px-3 py-2 text-right">Cá nhân đã chi</th>
                  <th className="px-3 py-2 text-right">Tổng chi lô</th>
                  <th className="px-3 py-2 text-right">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenseGroups.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Cá nhân này chưa chi khoản nào cho lô hàng.</td></tr>
                )}
                {expenseGroups.map((group, index) => (
                  <tr
                    key={group.shipment.id}
                    onClick={() => setSelectedShipmentId(group.shipment.id)}
                    className="cursor-pointer hover:bg-blue-50/60"
                  >
                    <td className="px-3 py-3 text-center text-gray-400">{index + 1}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-blue-700">TK {group.shipment.declarationNo || "chưa có số"}</p>
                      <p className="text-xs text-gray-500">{formatDate(group.shipment.declarationDate)}</p>
                    </td>
                    <td className="max-w-sm px-3 py-3">
                      <p className="font-medium text-gray-900">{group.shipment.goodsName || "Chưa có tên hàng"}</p>
                      <p className="truncate text-xs text-gray-500">{group.shipment.customerName}</p>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <p className="font-semibold text-red-700">{formatVnd(group.personAmount)}</p>
                      <p className="text-xs text-gray-400">{group.personCostCount} khoản</p>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <p className="font-semibold text-gray-900">{formatVnd(group.totalAmount)}</p>
                      <p className="text-xs text-gray-400">{group.totalCostCount} khoản</p>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedShipmentId(group.shipment.id);
                        }}
                        className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        Xem chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2">Ngày</th>
                <th className="px-3 py-2">Loại giao dịch</th>
                <th className="px-3 py-2">Nội dung</th>
                <th className="px-3 py-2">Lô hàng liên quan</th>
                <th className="px-3 py-2">Đối tượng</th>
                <th className="px-3 py-2">Chứng từ</th>
                <th className="px-3 py-2 text-right">Tiền vào</th>
                <th className="px-3 py-2 text-right">Tiền ra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Không có giao dịch phù hợp.</td></tr>
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
                    <td className="px-3 py-3">
                      {entry.attachmentUrl ? (
                        <AttachmentPreviewButton
                          url={entry.attachmentUrl}
                          name={entry.attachmentName}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          📎 {entry.attachmentName || "Xem ảnh"}
                        </AttachmentPreviewButton>
                      ) : <span className="text-gray-300">—</span>}
                      {entry.recordedBy && (
                        <p className="mt-1 text-xs text-gray-400">
                          Ghi nhận bởi {entry.recordedBy}{entry.recordedAt ? ` · ${formatDateTime(entry.recordedAt)}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-emerald-700">{isIncoming ? formatVnd(entry.amount) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-red-700">{!isIncoming ? formatVnd(entry.amount) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {selectedExpenseGroup && detail && (
            <ShipmentExpenseDetailModal
              person={detail.person}
              group={selectedExpenseGroup}
              costs={detail.shipmentCosts.filter(
                (cost) => cost.shipmentId === selectedExpenseGroup.shipment.id
              )}
              onClose={() => setSelectedShipmentId(null)}
            />
          )}
        </>
      )}
    </section>
  );
}

function ShipmentExpenseDetailModal({
  person,
  group,
  costs,
  onClose,
}: {
  person: { id: string; name: string };
  group: ShipmentExpenseGroup;
  costs: ShipmentCostDetail[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Chi tiết chi phí lô hàng</p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">
              TK {group.shipment.declarationNo || "chưa có số"} · {group.shipment.goodsName || "Chưa có tên hàng"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {formatDate(group.shipment.declarationDate)} · {group.shipment.customerName}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>

        <div className="grid gap-3 px-6 py-5 sm:grid-cols-2">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-medium text-red-700">{person.name} đã chi</p>
            <p className="mt-1 text-xl font-bold text-red-800">{formatVnd(group.personAmount)}</p>
            <p className="mt-1 text-xs text-red-600">{group.personCostCount} khoản</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-600">Tổng chi toàn lô</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{formatVnd(group.totalAmount)}</p>
            <p className="mt-1 text-xs text-gray-500">{group.totalCostCount} khoản</p>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2">Hạng mục</th>
                  <th className="px-3 py-2">Nhà cung cấp</th>
                  <th className="px-3 py-2">Người/TK đã chi</th>
                  <th className="px-3 py-2">Số hóa đơn</th>
                  <th className="px-3 py-2">Ghi chú</th>
                  <th className="px-3 py-2 text-right">Số tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {costs.map((cost) => {
                  const paidBySelectedPerson = cost.payerType === "PERSON" && cost.payerId === person.id;
                  return (
                    <tr key={cost.id} className={paidBySelectedPerson ? "bg-blue-50/70" : ""}>
                      <td className="px-3 py-3">
                        <p className="font-medium text-gray-900">{cost.label}</p>
                        {paidBySelectedPerson && <p className="text-xs font-medium text-blue-600">Khoản {person.name} đã chi</p>}
                      </td>
                      <td className="px-3 py-3 text-gray-600">{cost.vendorName || "—"}</td>
                      <td className="px-3 py-3 text-gray-600">{cost.payerName || "Chưa xác định"}</td>
                      <td className="px-3 py-3 text-gray-600">{cost.invoiceNumber || "—"}</td>
                      <td className="max-w-64 px-3 py-3 text-gray-500">{cost.note || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">{formatVnd(cost.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
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
          <h2 className="font-semibold text-gray-900">Tạm ứng và hoàn ứng giữa cá nhân</h2>
          <p className="mt-0.5 text-xs text-gray-500">Theo dõi rõ ai đưa tiền trước, ai nhận và khoản nào được hoàn lại.</p>
        </div>
        {onAdd && (
          <button type="button" onClick={onAdd} className="rounded-md border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50">+ Thêm</button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[1050px] text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2">Ngày chuyển</th>
              <th className="px-3 py-2">Nghiệp vụ</th>
              <th className="px-3 py-2">Người chuyển</th>
              <th className="px-3 py-2">Người nhận</th>
              <th className="px-3 py-2">Ghi chú</th>
              <th className="px-3 py-2">Ảnh chuyển tiền</th>
              <th className="px-3 py-2">Người ghi nhận</th>
              <th className="px-3 py-2 text-right">Số tiền</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {transfers.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Chưa có khoản tạm ứng/hoàn ứng nào.</td></tr>
            )}
            {transfers.map((transfer) => (
              <tr key={transfer.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 text-gray-600">{formatDate(transfer.transferDate)}</td>
                <td className="px-3 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${transfer.type === "ADVANCE" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                    {transfer.type === "ADVANCE" ? "Tạm ứng" : "Hoàn ứng"}
                  </span>
                </td>
                <td className="px-3 py-3 font-medium text-orange-700">{transfer.fromUser.name}</td>
                <td className="px-3 py-3 font-medium text-blue-700">{transfer.toUser.name}</td>
                <td className="max-w-64 px-3 py-3 text-gray-500">{transfer.note || "—"}</td>
                <td className="max-w-56 px-3 py-3">
                  {transfer.attachmentUrl ? (
                    <AttachmentPreviewButton
                      url={transfer.attachmentUrl}
                      name={transfer.attachmentName}
                      className="inline-block max-w-52 truncate font-medium text-blue-600 hover:underline"
                    >
                      📎 {transfer.attachmentName || "Xem ảnh"}
                    </AttachmentPreviewButton>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-3 text-gray-600">
                  <p>{transfer.createdBy?.name || "—"}</p>
                  <p className="text-xs text-gray-400">{formatDateTime(transfer.createdAt)}</p>
                </td>
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
  onClose,
  onSaved,
}: {
  persons: Account[];
  onClose: () => void;
  onSaved: (personIds: string[]) => void;
}) {
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [transferType, setTransferType] = useState<"ADVANCE" | "RETURN">("ADVANCE");
  const [amount, setAmount] = useState("");
  const [transferDate, setTransferDate] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleProofImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setFormError("Ảnh chuyển tiền chỉ chấp nhận tệp PNG, JPG hoặc JPEG.");
      return;
    }

    setUploading(true);
    setFormError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải ảnh chuyển tiền.");
      setAttachmentName(json.data.name || file.name);
      setAttachmentUrl(json.data.url);
    } catch (uploadError) {
      setFormError(uploadError instanceof Error ? uploadError.message : "Không thể tải ảnh chuyển tiền.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/reports/cash-flow/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromUserId,
          toUserId,
          transferType,
          amount,
          transferDate,
          note,
          attachmentName,
          attachmentUrl,
        }),
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
            <h2 className="text-xl font-semibold text-gray-900">Ghi nhận tạm ứng/hoàn ứng</h2>
            <p className="mt-1 text-sm text-gray-500">Khoản này chỉ điều chuyển tiền giữa hai cá nhân, không thuộc lô hàng.</p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
        </div>

        {formError && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

        <label className="mt-5 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Nghiệp vụ</span>
          <select value={transferType} onChange={(event) => setTransferType(event.target.value as "ADVANCE" | "RETURN")} className="input">
            <option value="ADVANCE">Tạm ứng — đưa tiền trước cho một cá nhân</option>
            <option value="RETURN">Hoàn ứng — trả lại tiền đã được tạm ứng</option>
          </select>
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
          <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} className="input min-h-20" placeholder="Lý do chuyển hoặc nội dung cần ghi nhớ" />
        </label>

        <div className="mt-4">
          <span className="mb-1 block text-sm font-medium text-gray-700">Ảnh chuyển tiền chứng minh</span>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {uploading ? "Đang tải ảnh..." : attachmentUrl ? "Đổi ảnh" : "+ Đính kèm ảnh"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              onChange={handleProofImageChange}
              className="hidden"
            />
            {attachmentUrl ? (
              <>
                <AttachmentPreviewButton
                  url={attachmentUrl}
                  name={attachmentName}
                  className="max-w-xs truncate text-sm font-medium text-blue-600 hover:underline"
                >
                  📎 {attachmentName || "Xem ảnh"}
                </AttachmentPreviewButton>
                <button
                  type="button"
                  onClick={() => {
                    setAttachmentName("");
                    setAttachmentUrl("");
                  }}
                  className="text-sm text-red-600 hover:underline"
                >
                  Bỏ ảnh
                </button>
              </>
            ) : (
              <span className="text-xs text-gray-400">PNG, JPG hoặc JPEG · tối đa 20MB</span>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Hủy</button>
          <button type="submit" disabled={saving || uploading} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Đang lưu..." : "Lưu tạm ứng/hoàn ứng"}
          </button>
        </div>
      </form>
    </div>
  );
}
