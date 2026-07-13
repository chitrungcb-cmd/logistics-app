import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { id } = await params;
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
    });
    if (!membership) return apiError("Bạn không phải thành viên của cuộc trò chuyện này.", 403);

    await prisma.conversationMember.update({
      where: { id: membership.id },
      data: { lastReadAt: new Date() },
    });

    return apiSuccess({ ok: true });
  } catch (error) {
    console.error("POST /api/conversations/[id]/read failed:", error);
    return apiError("Không thể đánh dấu đã đọc.", 500);
  }
}
