import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import DebtsClient from "./DebtsClient";

export default async function DebtsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "FIELD_STAFF") redirect("/");

  return <DebtsClient isAdmin={user.role === "ADMIN"} />;
}
