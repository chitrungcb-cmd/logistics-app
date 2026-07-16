import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">🔒</div>
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Chưa được cấp quyền truy cập</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          Tài khoản của bạn chưa được cấp mô-đun này. Hãy liên hệ Admin nếu cần sử dụng.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Về Tổng quan
        </Link>
      </div>
    </div>
  );
}
