"use client";

import CostPresetsClient from "./CostPresetsClient";

export default function SettingsClient() {
  return (
    <div>
      <header className="px-8 pt-8">
        <h1 className="text-2xl font-semibold text-gray-900">Cài đặt</h1>
        <p className="mt-1 text-sm text-gray-500">Quản lý cấu hình chi phí.</p>
      </header>

      <CostPresetsClient />
    </div>
  );
}
