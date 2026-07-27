import { requireModuleAccess } from "@/lib/module-access";
import ProfitReportClient from "./ProfitReportClient";

export default async function ProfitReportPage() {
  await requireModuleAccess("REPORTS");

  return <ProfitReportClient />;
}
