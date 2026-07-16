import ModuleAccessLayout from "@/components/ModuleAccessLayout";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleAccessLayout module="SETTINGS">{children}</ModuleAccessLayout>;
}
