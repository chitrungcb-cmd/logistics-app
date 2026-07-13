import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import ShipmentDetailClient from "./ShipmentDetailClient";

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  return <ShipmentDetailClient shipmentId={id} role={user.role} />;
}
