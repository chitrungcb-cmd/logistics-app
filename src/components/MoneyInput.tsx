"use client";

/**
 * Ô nhập tiền VND dùng chung cho mọi form: hiển thị tách hàng nghìn bằng dấu chấm (42.000.000) cho
 * dễ đọc, nhưng state bên ngoài vẫn giữ chuỗi số trần ("42000000") để mọi chỗ `Number(...)` hiện có
 * không phải đổi. Tiền VND là số nguyên nên chỉ nhận chữ số — ký tự khác bị loại ngay khi gõ/dán.
 * Dùng component này thay cho `<input type="number">` ở mọi ô tiền; `type="number"` chỉ còn dành cho
 * số lượng (có thể là số lẻ).
 */
export default function MoneyInput({
  value,
  onValueChange,
  className,
  placeholder,
  onBlur,
  onKeyDown,
  required,
  autoFocus,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (rawDigits: string) => void;
  className?: string;
  placeholder?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  // Parse bằng Number (không phải bóc chữ số) để một giá trị thập phân cũ trong DB như
  // "1500000.5" hiển thị ~1.500.001 thay vì bị hiểu nhầm thành 15.000.005.
  const numeric = value.trim() === "" ? null : Number(value);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={numeric == null || !Number.isFinite(numeric) ? "" : Math.round(numeric).toLocaleString("vi-VN")}
      onChange={(event) => onValueChange(event.target.value.replace(/\D/g, ""))}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={className}
      placeholder={placeholder}
      required={required}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}
