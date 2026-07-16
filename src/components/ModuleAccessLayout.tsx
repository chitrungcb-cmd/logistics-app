import { requireModuleAccess } from "@/lib/module-access";
import type { AppModule } from "@/lib/module-permissions";

export default async function ModuleAccessLayout({
  module,
  children,
}: {
  module: AppModule;
  children: React.ReactNode;
}) {
  await requireModuleAccess(module);
  return children;
}
