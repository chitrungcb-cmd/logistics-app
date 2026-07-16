import ModuleAccessLayout from "@/components/ModuleAccessLayout";

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return <ModuleAccessLayout module="TASKS">{children}</ModuleAccessLayout>;
}
