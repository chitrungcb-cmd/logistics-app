import { requireModuleAccess } from "@/lib/module-access";
import CostsClient from "./CostsClient";

export default async function CostsPage() {
  await requireModuleAccess("COSTS");

  return <CostsClient />;
}
