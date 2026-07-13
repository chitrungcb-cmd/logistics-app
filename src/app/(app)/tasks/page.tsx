import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import TasksClient from "./TasksClient";

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <TasksClient canManage={user.role !== "FIELD_STAFF"} />;
}
