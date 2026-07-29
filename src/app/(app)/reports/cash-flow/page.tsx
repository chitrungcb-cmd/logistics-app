import { requireModuleAccess } from "@/lib/module-access";
import CashFlowReportClient from "./CashFlowReportClient";

export default async function CashFlowReportPage() {
  const user = await requireModuleAccess("REPORTS");
  return (
    <CashFlowReportClient
      canManageAccounts={user.role === "ADMIN"}
      canManageTransfers={user.role === "ADMIN" || user.role === "ACCOUNTANT"}
    />
  );
}
