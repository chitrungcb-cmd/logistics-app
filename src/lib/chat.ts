import { prisma } from "@/lib/prisma";

export const COMPANY_CONVERSATION_NAME = "Toàn công ty";

/**
 * There's no "app startup" hook in this serverless-style Next.js deployment, so the single COMPANY
 * conversation is ensured lazily here (called from GET /api/conversations) rather than at boot.
 * Also backfills any user who isn't a member yet — covers both "first ever call" (channel doesn't
 * exist) and any user created before this feature existed.
 */
export async function ensureCompanyConversation(): Promise<string> {
  let company = await prisma.conversation.findFirst({ where: { type: "COMPANY" } });

  if (!company) {
    const firstAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
    if (!firstAdmin) throw new Error("Không thể tạo kênh chung: chưa có người dùng nào.");
    company = await prisma.conversation.create({
      data: { type: "COMPANY", name: COMPANY_CONVERSATION_NAME, createdByUserId: firstAdmin.id },
    });
  }

  const allUsers = await prisma.user.findMany({ select: { id: true } });
  const existingMembers = await prisma.conversationMember.findMany({
    where: { conversationId: company.id },
    select: { userId: true },
  });
  const existingIds = new Set(existingMembers.map((m) => m.userId));
  const missing = allUsers.filter((u) => !existingIds.has(u.id));

  if (missing.length > 0) {
    await prisma.conversationMember.createMany({
      data: missing.map((u) => ({ conversationId: company!.id, userId: u.id })),
      skipDuplicates: true,
    });
  }

  return company.id;
}

/** Adds a single newly-created user to the COMPANY channel — called from POST /api/users. */
export async function addUserToCompanyConversation(userId: string) {
  const companyId = await ensureCompanyConversation();
  await prisma.conversationMember.upsert({
    where: { conversationId_userId: { conversationId: companyId, userId } },
    create: { conversationId: companyId, userId },
    update: {},
  });
}

/** DIRECT conversations are never duplicated — reused whenever the same two users message again. */
export async function findOrCreateDirectConversation(userAId: string, userBId: string): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: {
      type: "DIRECT",
      members: { some: { userId: userAId } },
      AND: { members: { some: { userId: userBId } } },
    },
    include: { members: true },
  });
  const exact = existing && existing.members.length === 2 ? existing : null;
  if (exact) return exact.id;

  const created = await prisma.conversation.create({
    data: {
      type: "DIRECT",
      createdByUserId: userAId,
      members: { create: [{ userId: userAId }, { userId: userBId }] },
    },
  });
  return created.id;
}
