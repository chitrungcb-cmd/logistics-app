import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  return <UsersClient currentUserId={user.id} />;
}
