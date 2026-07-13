import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { notifyNewMessage } from "@/lib/notifications";

const MEMBER_SELECT = { select: { id: true, name: true, email: true, role: true } } as const;
const MESSAGE_LIMIT = 200;

async function assertMember(conversationId: string, userId: string) {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  return !!membership;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  const { id } = await params;
  if (!(await assertMember(id, user.id))) {
    return apiError("Bạn không phải thành viên của cuộc trò chuyện này.", 403);
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    include: {
      sender: MEMBER_SELECT,
      attachments: true,
      mentions: { include: { mentionedUser: MEMBER_SELECT } },
    },
    orderBy: { createdAt: "asc" },
    take: MESSAGE_LIMIT,
  });

  return apiSuccess(messages);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { id } = await params;
    if (!(await assertMember(id, user.id))) {
      return apiError("Bạn không phải thành viên của cuộc trò chuyện này.", 403);
    }

    const body = await request.json();
    const content: string | null = body.content?.trim() || null;
    const attachments: { fileUrl: string; fileName: string; fileType: string; fileSize: number }[] =
      Array.isArray(body.attachments) ? body.attachments : [];
    const mentionedUserIds: string[] = Array.isArray(body.mentionedUserIds) ? body.mentionedUserIds : [];

    if (!content && attachments.length === 0) {
      return apiError("Tin nhắn cần có nội dung hoặc tệp đính kèm.", 400);
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        senderId: user.id,
        content,
        attachments: { create: attachments },
        mentions: { create: mentionedUserIds.map((mentionedUserId) => ({ mentionedUserId })) },
      },
      include: {
        sender: MEMBER_SELECT,
        attachments: true,
        mentions: { include: { mentionedUser: MEMBER_SELECT } },
      },
    });

    // Bumps Conversation.updatedAt (via @updatedAt) so GET /api/conversations can sort by latest
    // activity with a plain orderBy instead of a subquery over messages.
    const conversation = await prisma.conversation.update({
      where: { id },
      data: {},
      include: { members: true },
    });

    await notifyNewMessage({
      senderId: user.id,
      senderName: user.name,
      conversationId: id,
      conversationName: conversation.name ?? "cuộc trò chuyện",
      memberUserIds: conversation.members.map((m) => m.userId),
      mentionedUserIds,
    });

    return apiSuccess(message, 201);
  } catch (error) {
    console.error("POST /api/conversations/[id]/messages failed:", error);
    return apiError("Không thể gửi tin nhắn.", 500);
  }
}
