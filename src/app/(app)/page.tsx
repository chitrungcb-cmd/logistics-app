import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-2 text-sm text-gray-500">
        Tổng quan hệ thống quản lý logistics.
      </p>
      <div className="mt-6">
        <Link
          href="/shipments"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Đi tới Quản lý lô hàng
        </Link>
      </div>
    </div>
  );
}
