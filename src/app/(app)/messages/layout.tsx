import ModuleAccessLayout from "@/components/ModuleAccessLayout";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return <ModuleAccessLayout module="MESSAGES">{children}</ModuleAccessLayout>;
}
