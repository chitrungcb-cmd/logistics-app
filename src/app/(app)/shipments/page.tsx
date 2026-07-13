import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import ShipmentsListClient from "./ShipmentsListClient";

export default async function ShipmentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <ShipmentsListClient isAdmin={user.role === "ADMIN"} />;
}
