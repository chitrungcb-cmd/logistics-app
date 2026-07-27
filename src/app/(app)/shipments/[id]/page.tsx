import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasModuleAccess } from "@/lib/module-permissions";
import ShipmentDetailClient from "./ShipmentDetailClient";

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  return <ShipmentDetailClient shipmentId={id} canViewCosts={hasModuleAccess(user, "COSTS")} />;
}
