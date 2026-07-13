import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import MessagesClient from "./MessagesClient";

export default async function MessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <MessagesClient currentUserId={user.id} />;
}
