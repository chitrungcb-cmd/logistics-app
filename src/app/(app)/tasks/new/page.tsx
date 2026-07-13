import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import NewTaskClient from "./NewTaskClient";

export default async function NewTaskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "FIELD_STAFF") redirect("/tasks");

  return <NewTaskClient />;
}
