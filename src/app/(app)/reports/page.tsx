import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function ReportsPage() {
  const user = await getCurrentUser();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Báo cáo</h1>
      <p className="mt-2 text-sm text-gray-500">Báo cáo tổng hợp hoạt động.</p>

      {user?.role === "ADMIN" ? (
        <Link
          href="/reports/profit"
          className="mt-6 block w-fit rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm"
        >
          <p className="font-medium text-gray-900">Báo cáo lãi lỗ</p>
          <p className="mt-1 text-sm text-gray-500">Tổng hợp thu, chi phí và lãi/lỗ theo thời gian.</p>
        </Link>
      ) : (
        <div className="mt-6 flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-sm text-gray-400">
          Module đang được xây dựng
        </div>
      )}
    </div>
  );
}
