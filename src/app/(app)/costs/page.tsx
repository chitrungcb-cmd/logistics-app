import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import CostsClient from "./CostsClient";

export default async function CostsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  return <CostsClient />;
}
