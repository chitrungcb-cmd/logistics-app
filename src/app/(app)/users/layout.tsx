import ModuleAccessLayout from "@/components/ModuleAccessLayout";

export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return <ModuleAccessLayout module="USERS">{children}</ModuleAccessLayout>;
}
