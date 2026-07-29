import { requireModuleAccess } from "@/lib/module-access";
import CostVarianceReportClient from "./CostVarianceReportClient";

export default async function CostVarianceReportPage() {
  await requireModuleAccess("REPORTS");
  return <CostVarianceReportClient />;
}
