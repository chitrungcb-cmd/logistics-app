import "dotenv/config";
import { validateProductionEnvironment } from "./lib/production-env.mjs";

const issues = validateProductionEnvironment(process.env);
if (issues.length > 0) {
  console.error("Cấu hình production chưa an toàn:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log("Cấu hình production hợp lệ.");
}
