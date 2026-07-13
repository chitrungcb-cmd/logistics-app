import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TaskDetailClient from "./TaskDetailClient";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) notFound();
  if (user.role === "FIELD_STAFF" && task.assignedToUserId !== user.id) {
    redirect("/tasks");
  }

  return <TaskDetailClient taskId={id} canManage={user.role !== "FIELD_STAFF"} />;
}
