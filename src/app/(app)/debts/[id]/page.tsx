import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import DebtDetailClient from "./DebtDetailClient";

export default async function DebtDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "FIELD_STAFF") redirect("/");

  const { id } = await params;
  return <DebtDetailClient debtId={id} isAdmin={user.role === "ADMIN"} currentUserId={user.id} />;
}
