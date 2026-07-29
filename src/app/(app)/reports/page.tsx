import Link from "next/link";
import { requireModuleAccess } from "@/lib/module-access";

export default async function ReportsPage() {
  await requireModuleAccess("REPORTS");

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Báo cáo</h1>
      <p className="mt-2 text-sm text-gray-500">Báo cáo tổng hợp hoạt động.</p>

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
        <Link href="/reports/cost-variance" className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 hover:border-amber-400 hover:shadow-sm">
          <p className="font-medium text-gray-900">So sánh chênh lệch chi phí</p>
          <p className="mt-1 text-sm text-gray-500">Phát hiện cùng mặt hàng nhưng đơn giá cùng hạng mục chênh lệch lớn giữa các lô.</p>
        </Link>
      </div>
    </div>
  );
}
