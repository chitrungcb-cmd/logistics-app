import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import CostPresetsClient from "./CostPresetsClient";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  return <CostPresetsClient />;
}
