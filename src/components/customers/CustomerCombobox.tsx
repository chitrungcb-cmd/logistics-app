"use client";

import { useEffect, useRef, useState } from "react";

type CustomerOption = { id: string; companyName: string; taxCode: string };

export default function CustomerCombobox({
  customerName,
  customerId,
  onChange,
}: {
  customerName: string;
  customerId: string | null;
  onChange: (value: { customerName: string; customerId: string | null }) => void;
}) {
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fetch(`/api/customers?search=${encodeURIComponent(customerName.trim())}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setOptions(json.data);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [customerName, isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <input
        value={customerName}
        onChange={(e) => {
          onChange({ customerName: e.target.value, customerId: null });
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className="input"
        placeholder="Tên khách hàng hoặc mã số thuế"
        autoComplete="off"
      />
      {customerId && (
        <span className="mt-1 block text-xs text-green-600">✓ Đã liên kết khách hàng có sẵn</span>
      )}
      {isOpen && options.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ customerName: option.companyName, customerId: option.id });
                  setIsOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{option.companyName}</span>
                <span className="ml-2 text-xs text-gray-400">{option.taxCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
