import { spawnSync } from "node:child_process";

// Hostinger injects production variables into the build process. Local builds do
// not need a production database, so they can continue without applying migrations.
if (!process.env.DIRECT_URL) {
  console.log("Bỏ qua cập nhật cơ sở dữ liệu: môi trường build không có DIRECT_URL.");
  process.exit(0);
}

console.log("Đang cập nhật cấu trúc cơ sở dữ liệu...");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(executable, ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
});

if (result.error) {
  console.error("Không thể chạy cập nhật cơ sở dữ liệu:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
