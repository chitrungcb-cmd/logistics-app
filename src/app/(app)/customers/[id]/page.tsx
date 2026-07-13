import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import CustomerDetailClient from "./CustomerDetailClient";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  return <CustomerDetailClient customerId={id} canManage={user.role !== "FIELD_STAFF"} />;
}
