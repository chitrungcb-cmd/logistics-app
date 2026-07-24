import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function ReportsPage() {
  const user = await getCurrentUser();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Báo cáo</h1>
      <p className="mt-2 text-sm text-gray-500">Báo cáo tổng hợp hoạt động.</p>

      {user?.role === "ADMIN" ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Link href="/reports/profit" className="rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm">
            <p className="font-medium text-gray-900">Báo cáo lãi lỗ</p>
            <p className="mt-1 text-sm text-gray-500">Tổng hợp thu, chi phí và lãi/lỗ theo thời gian.</p>
          </Link>
          <Link href="/reports/cash-flow" className="rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm">
            <p className="font-medium text-gray-900">Thu – chi theo tài khoản</p>
            <p className="mt-1 text-sm text-gray-500">Ai thu, ai chi những gì: theo TK công ty và từng cá nhân.</p>
          </Link>
          <Link href="/reports/vendor-payables" className="rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm">
            <p className="font-medium text-gray-900">Phải trả nhà cung cấp</p>
            <p className="mt-1 text-sm text-gray-500">Theo tháng: mỗi công ty phục vụ bao nhiêu lô và tổng số tiền phải trả.</p>
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-sm text-gray-400">
          Module đang được xây dựng
        </div>
      )}
    </div>
  );
}
