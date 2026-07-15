import { NextResponse } from "next/server";

const PRIVATE_API_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export function apiSuccess<T>(data: T, init?: number) {
  return NextResponse.json(
    { success: true, data },
    { status: init ?? 200, headers: PRIVATE_API_HEADERS }
  );
}

export function apiError(message: string, status = 400, headers?: HeadersInit) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: { ...PRIVATE_API_HEADERS, ...Object.fromEntries(new Headers(headers)) } }
  );
}
