import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import VendorPayablesReportClient from "./VendorPayablesReportClient";

export default async function VendorPayablesReportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/reports");
  return <VendorPayablesReportClient />;
}
