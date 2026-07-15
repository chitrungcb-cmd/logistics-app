import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import PartnersClient from "./PartnersClient";

export default async function PartnersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "FIELD_STAFF") redirect("/");

  return <PartnersClient isAdmin={user.role === "ADMIN"} />;
}
