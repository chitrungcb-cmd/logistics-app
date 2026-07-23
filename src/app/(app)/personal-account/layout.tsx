import ModuleAccessLayout from "@/components/ModuleAccessLayout";

export default function PersonalAccountLayout({ children }: { children: React.ReactNode }) {
  return <ModuleAccessLayout module="PERSONAL_ACCOUNT">{children}</ModuleAccessLayout>;
}
