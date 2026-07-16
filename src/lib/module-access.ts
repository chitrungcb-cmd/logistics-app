import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasModuleAccess, type AppModule } from "@/lib/module-permissions";

export async function requireModuleAccess(module: AppModule) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasModuleAccess(user, module)) redirect("/forbidden");
  return user;
}
