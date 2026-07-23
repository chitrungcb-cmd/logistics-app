"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PaginationControls from "@/components/PaginationControls";
import type { PaginationMeta } from "@/lib/pagination";

const PAGE_SIZE = 50;
const EMPTY_PAGINATION: PaginationMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 };

type Customer = {
  id: string;
  companyName: string;
  taxCode: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export default function CustomersClient({ canManage }: { canManage: boolean }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta>(EMPTY_PAGINATION);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        search: search.trim(),
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      setIsLoading(true);
      fetch(`/api/customers?${params}`)
        .then((res) => res.json())
        .then((json) => {
          if (!json.success) throw new Error(json.error || "Không thể tải danh sách khách hàng.");
          if (!cancelled) {
            setCustomers(json.data.items);
            setPagination(json.data.pagination);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page, search]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Khách hàng</h1>
          <p className="mt-1 text-sm text-gray-500">Quản lý thông tin khách hàng.</p>
        </div>
        {canManage && (
          <Link
            href="/customers/new"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Thêm khách hàng
          </Link>
        )}
      </div>

      <div className="mb-4 mt-6">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Tìm theo tên công ty hoặc mã số thuế..."
          className="input max-w-xs"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">STT</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tên công ty</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Mã số thuế</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Điện thoại</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Địa chỉ</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  Đang tải dữ liệu...
                </td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!isLoading && !error && customers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  {search ? "Không có khách hàng khớp tìm kiếm." : "Chưa có khách hàng nào."}
                </td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              customers.map((customer, index) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">
                    {(pagination.page - 1) * pagination.pageSize + index + 1}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{customer.companyName}</td>
                  <td className="px-4 py-3 text-gray-600">{customer.taxCode}</td>
                  <td className="px-4 py-3 text-gray-600">{customer.phone || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{customer.email || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{customer.address || "—"}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      Xem chi tiết
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={pagination} onPageChange={setPage} />
    </div>
  );
}
