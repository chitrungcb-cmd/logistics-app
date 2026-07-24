import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import CashFlowReportClient from "./CashFlowReportClient";

export default async function CashFlowReportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/reports");
  return <CashFlowReportClient />;
}
