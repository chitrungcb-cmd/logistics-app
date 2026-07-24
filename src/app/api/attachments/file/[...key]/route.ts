import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import {
  contentTypeForFileName,
  fetchPrivateObject,
  fileNameFromObjectKey,
  privateFileUrl,
  privateObjectKeyFromUrl,
} from "@/lib/private-storage";

export const runtime = "nodejs";

function contentDisposition(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const mode = extension && ["pdf", "png", "jpg", "jpeg"].includes(extension) ? "inline" : "attachment";
  const fallback = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replaceAll('"', "") || "attachment";
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ key: string[] }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { key: keyParts } = await context.params;
    const key = privateObjectKeyFromUrl(privateFileUrl(keyParts.join("/")));
    if (!key) return apiError("Đường dẫn tệp không hợp lệ.", 400);

    const upstream = await fetchPrivateObject(key, request.headers.get("range"));
    const requestedName = request.nextUrl.searchParams.get("name");
    const fileName =
      requestedName &&
      requestedName.length <= 180 &&
      !requestedName.includes("/") &&
      !requestedName.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(requestedName)
        ? requestedName
        : fileNameFromObjectKey(key);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(fileName),
      "Content-Type": upstream.headers.get("content-type") || contentTypeForFileName(fileName),
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of ["accept-ranges", "content-length", "content-range", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error("GET /api/attachments/file failed:", error);
    return apiError("Không thể mở tệp đính kèm.", 404);
  }
}
