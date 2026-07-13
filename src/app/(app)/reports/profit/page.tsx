import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import ProfitReportClient from "./ProfitReportClient";

export default async function ProfitReportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/reports");

  return <ProfitReportClient />;
}
