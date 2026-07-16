"use client";

import { useState } from "react";
import CostPresetsClient from "./CostPresetsClient";
import VendorsSettingsClient from "./VendorsSettingsClient";

type SettingsTab = "cost-presets" | "vendors";

export default function SettingsClient() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("cost-presets");

  return (
    <div>
      <header className="px-8 pt-8">
        <h1 className="text-2xl font-semibold text-gray-900">Cài đặt</h1>
        <p className="mt-1 text-sm text-gray-500">Quản lý cấu hình chi phí và thông tin nhà cung cấp.</p>
      </header>

      <nav className="mt-6 flex gap-6 border-b border-gray-200 px-8" aria-label="Mục cài đặt">
        <button
          type="button"
          onClick={() => setActiveTab("cost-presets")}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
            activeTab === "cost-presets"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
          aria-current={activeTab === "cost-presets" ? "page" : undefined}
        >
          Cấu hình chi phí
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("vendors")}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
            activeTab === "vendors"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
          aria-current={activeTab === "vendors" ? "page" : undefined}
        >
          Nhà cung cấp
        </button>
      </nav>

      {activeTab === "cost-presets" ? <CostPresetsClient /> : <VendorsSettingsClient />}
    </div>
  );
}
