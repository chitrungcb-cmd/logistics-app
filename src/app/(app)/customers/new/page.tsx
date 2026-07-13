import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import NewCustomerClient from "./NewCustomerClient";

export default async function NewCustomerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "FIELD_STAFF") redirect("/customers");

  return <NewCustomerClient />;
}
