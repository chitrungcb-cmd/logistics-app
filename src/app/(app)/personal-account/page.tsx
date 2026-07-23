import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import PersonalAccountClient from "./PersonalAccountClient";

export default async function PersonalAccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "FIELD_STAFF") redirect("/forbidden");

  return <PersonalAccountClient />;
}
