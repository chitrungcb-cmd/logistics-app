import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import OtherExpensesClient from "./OtherExpensesClient";

export default async function OtherExpensesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "FIELD_STAFF") redirect("/forbidden");

  return <OtherExpensesClient />;
}
