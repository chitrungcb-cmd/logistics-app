"use client";

import { useEffect, useRef, useState } from "react";

type VendorOption = { id: string; name: string; type: string | null };

export default function VendorCombobox({
  vendorName,
  vendorId,
  onChange,
}: {
  vendorName: string;
  vendorId: string | null;
  onChange: (value: { vendorName: string; vendorId: string | null }) => void;
}) {
  const [options, setOptions] = useState<VendorOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fetch(`/api/vendors?search=${encodeURIComponent(vendorName.trim())}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setOptions(json.data);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [vendorName, isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleCreate() {
    const name = vendorName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.success) {
        onChange({ vendorName: json.data.name, vendorId: json.data.id });
        setIsOpen(false);
      }
    } finally {
      setIsCreating(false);
    }
  }

  const exactMatch = options.some((o) => o.name.toLowerCase() === vendorName.trim().toLowerCase());

  return (
    <div className="relative" ref={containerRef}>
      <input
        value={vendorName}
        onChange={(e) => {
          onChange({ vendorName: e.target.value, vendorId: null });
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className="input"
        placeholder="Tên nhà cung cấp"
        autoComplete="off"
      />
      {vendorId && <span className="mt-1 block text-xs text-green-600">✓ Đã chọn nhà cung cấp có sẵn</span>}
      {isOpen && (options.length > 0 || vendorName.trim()) && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ vendorName: option.name, vendorId: option.id });
                  setIsOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{option.name}</span>
                {option.type && <span className="ml-2 text-xs text-gray-400">{option.type}</span>}
              </button>
            </li>
          ))}
          {vendorName.trim() && !exactMatch && (
            <li>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="block w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                {isCreating ? "Đang tạo..." : `+ Tạo nhà cung cấp mới "${vendorName.trim()}"`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
