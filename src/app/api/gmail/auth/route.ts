import { NextResponse } from "next/server";
import { getGoogleAuthUrl } from "@/lib/google";

export async function GET() {
  return NextResponse.redirect(getGoogleAuthUrl());
}
