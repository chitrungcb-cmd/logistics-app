import ModuleAccessLayout from "@/components/ModuleAccessLayout";

export default function CustomersLayout({ children }: { children: React.ReactNode }) {
  return <ModuleAccessLayout module="CUSTOMERS">{children}</ModuleAccessLayout>;
}
