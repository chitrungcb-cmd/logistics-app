import { requireModuleAccess } from "@/lib/module-access";
import VendorPayablesReportClient from "./VendorPayablesReportClient";

export default async function VendorPayablesReportPage() {
  await requireModuleAccess("REPORTS");

  return <VendorPayablesReportClient />;
}
