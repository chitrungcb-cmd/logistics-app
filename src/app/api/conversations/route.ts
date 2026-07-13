import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { ensureCompanyConversation, findOrCreateDirectConversation } from "@/lib/chat";

const MEMBER_SELECT = { select: { id: true, name: true, email: true, role: true } } as const;

// Every role can message — this is an internal comms tool, not financial data (unlike /api/costs).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  await ensureCompanyConversation();

  const memberships = await prisma.conversationMember.findMany({
    where: { userId: user.id },
    select: { conversationId: true, lastReadAt: true },
  });
  const lastReadByConversation = new Map(memberships.map((m) => [m.conversationId, m.lastReadAt]));

  const conversations = await prisma.conversation.findMany({
    where: { id: { in: memberships.map((m) => m.conversationId) } },
    include: {
      members: { include: { user: MEMBER_SELECT } },
      relatedShipment: { select: { id: true, shipmentCode: true, goodsName: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: MEMBER_SELECT } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const withUnreadCounts = await Promise.all(
    conversations.map(async (c) => {
      const lastReadAt = lastReadByConversation.get(c.id) ?? null;
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: c.id,
          senderId: { not: user.id },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      });
      return { ...c, unreadCount };
    })
  );

  return apiSuccess(withUnreadCounts);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const body = await request.json();

    if (body.type === "DIRECT") {
      if (!body.otherUserId) return apiError("Thiếu người nhận.", 400);
      const conversationId = await findOrCreateDirectConversation(user.id, body.otherUserId);
      return apiSuccess({ id: conversationId }, 201);
    }

    if (body.type === "GROUP") {
      if (!body.name || !Array.isArray(body.memberIds) || body.memberIds.length === 0) {
        return apiError("Vui lòng nhập tên nhóm và chọn thành viên.", 400);
      }
      const memberIds = [...new Set([user.id, ...body.memberIds])] as string[];
      const conversation = await prisma.conversation.create({
        data: {
          type: "GROUP",
          name: body.name,
          relatedShipmentId: body.relatedShipmentId || null,
          createdByUserId: user.id,
          members: { create: memberIds.map((userId) => ({ userId })) },
        },
        include: {
          members: { include: { user: MEMBER_SELECT } },
          relatedShipment: { select: { id: true, shipmentCode: true, goodsName: true } },
        },
      });
      return apiSuccess(conversation, 201);
    }

    return apiError("Loại cuộc trò chuyện không hợp lệ.", 400);
  } catch (error) {
    console.error("POST /api/conversations failed:", error);
    return apiError("Không thể tạo cuộc trò chuyện.", 500);
  }
}
