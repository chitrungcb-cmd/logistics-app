// Tự đồng bộ Gmail định kỳ NGAY TRONG tiến trình server. Hostinger chạy Node lâu dài nên interval
// này sống mãi cùng server — không phụ thuộc máy Mac, GitHub Actions hay cron ngoài. Next.js gọi
// register() một lần khi server khởi động (chỉ ở runtime Node, không phải Edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Tránh tạo trùng interval khi module bị nạp lại (hot-reload dev, hoặc register gọi nhiều lần).
  const g = globalThis as typeof globalThis & { __gmailSyncTimer?: ReturnType<typeof setInterval> };
  if (g.__gmailSyncTimer) return;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[gmail-auto-sync] Thiếu CRON_SECRET — không bật tự đồng bộ.");
    return;
  }

  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}/api/gmail/sync`;
  const EVERY_MS = 5 * 60 * 1000;

  async function tick() {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      // 202 = đã nhận, đang chạy nền — bình thường, không phải lỗi.
      if (!res.ok && res.status !== 202) {
        console.warn(`[gmail-auto-sync] HTTP ${res.status}`);
      }
    } catch (error) {
      console.warn("[gmail-auto-sync] gọi nội bộ lỗi:", error);
    }
  }

  g.__gmailSyncTimer = setInterval(tick, EVERY_MS);
  // Chạy một nhịp sớm sau khi server đã sẵn sàng nhận request (đợi ~30s).
  setTimeout(tick, 30_000);
  console.log(`[gmail-auto-sync] Đã bật tự đồng bộ mỗi ${EVERY_MS / 60_000} phút.`);
}
