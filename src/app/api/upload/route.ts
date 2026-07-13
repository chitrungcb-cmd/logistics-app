import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api-response";
import { saveUploadedFile } from "@/lib/save-upload";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return apiError("Không có tệp nào được gửi lên.", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveUploadedFile(file.name, buffer);

    return apiSuccess(saved, 201);
  } catch (error) {
    console.error("POST /api/upload failed:", error);
    return apiError("Không thể tải lên tệp đính kèm.", 500);
  }
}
