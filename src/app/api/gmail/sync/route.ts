import type { gmail_v1 } from "googleapis";
import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  getAuthorizedGmailClient,
  verifyGmailClient,
} from "@/lib/google";
import { isExpiredGmailTokenError } from "@/lib/gmail-errors";
import { parseTokhaiExcel, type ParsedDeclaration } from "@/lib/tokhai-parser";
import { saveUploadedFile } from "@/lib/save-upload";
import { prisma } from "@/lib/prisma";
import {
  attachmentBelongsToDeclarationFamilies,
  attachmentMatchesDeclaration,
  declarationNumbersFromFilename,
  generateShipmentCode,
  isClearanceDecisionFilename,
  isHysAttachment,
  mergeUniqueAttachments,
  removeAttachmentsFromDeletedMessages,
  mergeDeclarationBranch,
  sharesDeclarationFamily,
  resolveSyncedShipmentStatus,
  type Attachment,
} from "@/lib/shipment-constants";
import { applyCostPresetsToShipment } from "@/lib/cost-presets";
import { ensureShipmentWorkflowTasks } from "@/lib/shipment-workflow";
import { ensureConsultationTask } from "@/lib/consultation-task";
import { syncVendorInvoices, type VendorInvoiceSyncSummary } from "@/lib/vendor-invoice-sync";
import { notifyNewShipmentAssignees, syncMissingActualCostAlerts } from "@/lib/notifications";
import {
  backfillShipmentVehicleIndex,
  indexShipmentVehiclesFromAttachments,
} from "@/lib/shipment-vehicle-index";

// How many *new* (not-yet-processed) messages one sync call takes on. Gmail returns matches
// newest-first, and every call starts pagination from page 1 — so once the newest ~500 are already
// processed, capping by raw messages-seen would keep re-fetching the same done page forever and
// never reach older backlog. Capping by new-message count instead means every run makes progress
// until the whole mailbox is caught up, however many pages that takes.
const NEW_MESSAGES_PER_SYNC = 150;
// v3 also scans HYS-only replies in the same Gmail thread as a declaration email.
const SHIPMENT_SYNC_MARKER = "[shipment-attachments-v3]";

// Khoá đồng bộ trong bộ nhớ tiến trình. Lưu MỐC bắt đầu (thay cho cờ bật/tắt) để nếu một lần sync bị
// treo và không bao giờ nhả khoá, lần gọi kế tiếp vẫn tự vượt qua sau SYNC_STALE_MS — khoá không thể
// kẹt vĩnh viễn khiến "đồng bộ ngay"/cron mãi báo "đang chạy" cho tới khi restart server.
const SYNC_STALE_MS = 5 * 60 * 1000;
let syncStartedAt: number | null = null;
function syncIsRunning() {
  return syncStartedAt !== null && Date.now() - syncStartedAt < SYNC_STALE_MS;
}

export const runtime = "nodejs";

function hasValidCronSecret(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!configuredSecret || !authorization?.startsWith("Bearer ")) return false;

  const configuredBuffer = Buffer.from(configuredSecret, "utf8");
  const providedBuffer = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  return configuredBuffer.length === providedBuffer.length && timingSafeEqual(configuredBuffer, providedBuffer);
}

async function getSyncActor(request: NextRequest) {
  if (hasValidCronSecret(request)) {
    // Automated work still uses an active administrator as the accountable actor on tasks/audit rows.
    return prisma.user.findFirst({
      where: { role: "ADMIN", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true },
    });
  }
  return getCurrentUser();
}

type AttachmentPart = { filename: string; mimeType: string; attachmentId: string };

function collectAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined): AttachmentPart[] {
  if (!part) return [];
  const found: AttachmentPart[] = [];

  if (part.filename && part.body?.attachmentId) {
    found.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      attachmentId: part.body.attachmentId,
    });
  }

  for (const child of part.parts ?? []) {
    found.push(...collectAttachmentParts(child));
  }

  return found;
}

// goodsName is sourced from the email subject line, not the declaration file's own "Tên hàng"
// field — the subject is what staff actually recognize the shipment by in their inbox.
function getSubject(message: gmail_v1.Schema$Message) {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")?.value ?? null;
}

const REPLY_FORWARD_PREFIX = /^(re|fwd|fw)\s*:\s*/i;

/**
 * Subjects that follow the mailbox's own convention look like
 * "{Khách hàng} - {Tên hàng} [Mã tham chiếu] - {Cửa khẩu/Cảng}" (customer and port bookend the
 * subject; a trailing internal reference code, e.g. "XSCKYN-2026009" or "SW2026200771C-2", is
 * often appended right before the port separator). goodsName should be just the descriptive
 * middle part — strip the customer/port and any trailing reference code, not the whole subject.
 * A reference-code token is distinguished from a legitimate trailing model/quantity number (e.g.
 * "300", "D8-5700" when not last) by requiring a digit *plus* either a letter or a hyphen/slash —
 * plain quantity/model numbers in this mailbox never contain those.
 * Subjects that don't follow the convention (informal one-off notes, no " - " separators) are
 * returned unchanged — verified against all 393 real declaration emails in the mailbox.
 */
function extractGoodsName(rawSubject: string): string {
  let subject = rawSubject.trim();
  while (REPLY_FORWARD_PREFIX.test(subject)) {
    subject = subject.replace(REPLY_FORWARD_PREFIX, "").trim();
  }

  const parts = subject.split(" - ").map((p) => p.trim());
  if (parts.length < 3) return subject;

  let middle = parts.slice(1, -1).join(" - ");
  const words = middle.split(/\s+/);
  const lastWord = words[words.length - 1] ?? "";
  const looksLikeReferenceCode =
    /[0-9]/.test(lastWord) && (/[A-Za-z]/.test(lastWord) || lastWord.includes("-") || lastWord.includes("/"));
  if (words.length > 1 && looksLikeReferenceCode) {
    words.pop();
    middle = words.join(" ");
  }

  return middle || subject;
}

function isDeclarationFile(filename: string) {
  const normalized = filename.toLowerCase().replace(/\s+/g, "");
  return normalized.includes("tokhai") && normalized.endsWith(".xlsx");
}

/**
 * Upsert, not create: guards against the same message ID being processed twice in one run (Gmail's
 * search pagination has been observed returning a message on more than one page) without treating
 * that race as a hard error.
 */
async function recordProcessedEmail(data: {
  gmailMessageId: string;
  shipmentId?: string;
  status: string;
  detail: string;
}) {
  const versionedData = {
    ...data,
    detail: `${SHIPMENT_SYNC_MARKER} ${data.detail}`,
  };
  const { gmailMessageId, ...rest } = versionedData;
  await prisma.processedEmail.upsert({
    where: { gmailMessageId },
    create: versionedData,
    update: rest,
  });
}

/**
 * Two unrelated VNACCS mechanisms both need matching against an already-synced shipment, and one
 * declaration can be subject to either (or neither):
 *  1. Auto-split (>50 line items): each split-off declaration gets an unrelated-looking number, but
 *     explicitly names the original in "Số tờ khai đầu tiên" (`firstDeclarationNo`). Authoritative —
 *     checked first.
 *  2. Amendment/resubmission: VNACCS reissues the *same* declaration under a new trailing digit, with
 *     no field cross-referencing the earlier one — only detectable by the shared 11-digit prefix
 *     (handled by `mergeDeclarationBranch`, not here). To even find the existing shipment in this
 *     case we fall back to a shared invoice number (`invoiceNo`), a real business identifier.
 *     (An earlier version guessed matches from a shared 11-digit prefix directly; that produced false
 *     positives — two *unrelated* declarations issued by the same customs office around the same time
 *     can share that prefix by coincidence. Trust invoice, not digits, for finding the record; digits
 *     still decide same-declaration vs. genuine-new-branch once found.)
 * Exact match is checked first in both cases since it's cheapest and most common (the same message
 * reprocessed, or a reply carrying the identical declaration again).
 */
async function findMatchingShipment(parsed: ParsedDeclaration) {
  const exact = await prisma.shipment.findFirst({ where: { declarationNo: parsed.declarationNo } });
  if (exact) return exact;

  if (parsed.firstDeclarationNo) {
    const bySplit = await prisma.shipment.findFirst({
      where: {
        OR: [
          { declarationNo: parsed.firstDeclarationNo },
          { declarationBranches: { array_contains: [parsed.firstDeclarationNo] } },
        ],
      },
    });
    if (bySplit) return bySplit;
  }

  if (parsed.invoiceNo) {
    const byInvoice = await prisma.shipment.findFirst({ where: { invoiceNo: parsed.invoiceNo } });
    // Chỉ coi là cùng lô khi tờ khai mới là bản sửa/nộp lại của một tờ khai đã có trên lô đó (cùng
    // prefix 11 số). Một invoice thương mại có thể phủ nhiều tờ khai riêng biệt (khác prefix, không có
    // "số tờ khai đầu tiên"); những cái đó phải là lô riêng — không gộp chỉ vì trùng invoice.
    if (byInvoice && sharesDeclarationFamily(byInvoice, parsed.declarationNo)) return byInvoice;
  }

  return null;
}

/**
 * Finds or creates the Customer this declaration belongs to (by taxCode, the one field VNACCS never
 * omits for a registered company) and backfills address/phone if the record is missing them — but
 * never overwrites an existing non-null value, since staff may have hand-corrected it (same rule as
 * `customerName`/`taxCode` on an existing Shipment, see findMatchingShipment above). Only wired into
 * shipment *creation*, not updates — an existing shipment's customerId is left alone once set, same
 * as customerName/taxCode.
 */
async function findOrCreateCustomer(parsed: ParsedDeclaration): Promise<string | null> {
  if (!parsed.taxCode) return null;

  const existing = await prisma.customer.findUnique({ where: { taxCode: parsed.taxCode } });
  if (!existing) {
    const created = await prisma.customer.create({
      data: {
        companyName: parsed.customerName ?? "Chưa xác định",
        taxCode: parsed.taxCode,
        address: parsed.address,
        phone: parsed.phone,
      },
    });
    return created.id;
  }

  const missingFields: Record<string, string> = {};
  if (!existing.address && parsed.address) missingFields.address = parsed.address;
  if (!existing.phone && parsed.phone) missingFields.phone = parsed.phone;
  if (Object.keys(missingFields).length > 0) {
    await prisma.customer.update({ where: { id: existing.id }, data: missingFields });
  }

  return existing.id;
}

/**
 * Repairs shipments whose QDTQ attachment was saved by an older sync but whose status was not
 * advanced. Those Gmail messages already have ProcessedEmail rows, so a normal re-sync will not
 * revisit them.
 */
async function reconcileClearanceStatuses() {
  const storedShipments = await prisma.shipment.findMany({
    where: { status: "Đưa hàng về bảo quản" },
    select: { id: true, attachments: true },
  });
  const clearedIds = storedShipments
    .filter((shipment) => {
      if (!Array.isArray(shipment.attachments)) return false;
      return (shipment.attachments as unknown as Attachment[]).some(
        (attachment) =>
          typeof attachment?.name === "string" && isClearanceDecisionFilename(attachment.name)
      );
    })
    .map((shipment) => shipment.id);

  if (clearedIds.length === 0) return 0;
  const result = await prisma.shipment.updateMany({
    where: { id: { in: clearedIds }, status: "Đưa hàng về bảo quản" },
    data: { status: "Thông quan" },
  });
  return result.count;
}

async function loadGmailAttachment(
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>,
  messageId: string,
  part: AttachmentPart,
  cache: Map<string, Buffer>
) {
  const cached = cache.get(part.attachmentId);
  if (cached) return cached;

  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: part.attachmentId,
  });
  const buffer = Buffer.from(response.data.data ?? "", "base64url");
  cache.set(part.attachmentId, buffer);
  return buffer;
}

async function findShipmentByDeclarationNumber(declarationNo: string) {
  return prisma.shipment.findFirst({
    where: {
      OR: [
        { declarationNo },
        { declarationBranches: { array_contains: [declarationNo] } },
      ],
    },
  });
}

/**
 * HYS is commonly sent in a reply after the declaration email, without attaching ToKhai again.
 * Resolve that reply to a shipment using an explicit declaration number first, then the Gmail
 * thread. A thread containing more than one shipment is deliberately left unmatched rather than
 * guessing and putting chassis/engine data on the wrong lot.
 */
async function findShipmentForSupplementalHys(input: {
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>;
  message: gmail_v1.Schema$Message;
  attachmentParts: AttachmentPart[];
}) {
  const explicitNumbers = new Set<string>();
  for (const part of input.attachmentParts) {
    for (const number of declarationNumbersFromFilename(part.filename)) {
      explicitNumbers.add(number);
    }
  }
  const rawSubject = getSubject(input.message);
  if (rawSubject) {
    for (const number of declarationNumbersFromFilename(rawSubject)) {
      explicitNumbers.add(number);
    }
  }

  const explicitShipments = new Map<string, Awaited<ReturnType<typeof findShipmentByDeclarationNumber>>>();
  for (const declarationNo of explicitNumbers) {
    const shipment = await findShipmentByDeclarationNumber(declarationNo);
    if (shipment) explicitShipments.set(shipment.id, shipment);
  }
  if (explicitShipments.size === 1) {
    return [...explicitShipments.values()][0];
  }
  if (explicitShipments.size > 1 || !input.message.threadId) return null;

  const thread = await input.gmail.users.threads.get({
    userId: "me",
    id: input.message.threadId,
    format: "full",
  });
  const threadShipments = new Map<string, NonNullable<Awaited<ReturnType<typeof findMatchingShipment>>>>();

  for (const threadMessage of thread.data.messages ?? []) {
    if (!threadMessage.id) continue;
    const declarationParts = collectAttachmentParts(threadMessage.payload).filter((part) =>
      isDeclarationFile(part.filename)
    );
    const attachmentCache = new Map<string, Buffer>();
    for (const part of declarationParts) {
      try {
        const buffer = await loadGmailAttachment(
          input.gmail,
          threadMessage.id,
          part,
          attachmentCache
        );
        const parsed = await parseTokhaiExcel(buffer);
        if (!parsed) continue;
        const shipment = await findMatchingShipment(parsed);
        if (shipment) threadShipments.set(shipment.id, shipment);
      } catch (error) {
        console.error(
          `Could not inspect declaration ${part.filename} in Gmail thread ${input.message.threadId}:`,
          error
        );
      }
    }
  }

  return threadShipments.size === 1 ? [...threadShipments.values()][0] : null;
}

async function syncSupplementalHysFromMessage(input: {
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>;
  messageId: string;
  message: gmail_v1.Schema$Message;
  attachmentParts: AttachmentPart[];
}) {
  const hysParts = input.attachmentParts.filter((part) =>
    isHysAttachment(part.filename)
  );
  if (hysParts.length === 0) {
    return {
      status: "skipped" as const,
      detail: "Email không có file HYS Excel để ghép với lô hàng.",
    };
  }

  const shipment = await findShipmentForSupplementalHys({
    gmail: input.gmail,
    message: input.message,
    attachmentParts: hysParts,
  });
  if (!shipment) {
    return {
      status: "skipped" as const,
      detail:
        "Có file HYS nhưng chưa xác định duy nhất được lô hàng từ số tờ khai hoặc chuỗi email.",
    };
  }

  const attachmentCache = new Map<string, Buffer>();
  const savedAttachments: Attachment[] = [];
  for (const part of hysParts) {
    const buffer = await loadGmailAttachment(
      input.gmail,
      input.messageId,
      part,
      attachmentCache
    );
    const saved = await saveUploadedFile(part.filename, buffer);
    savedAttachments.push({
      ...saved,
      uploadedAt: new Date().toISOString(),
      gmailMessageId: input.messageId,
      gmailThreadId: input.message.threadId ?? undefined,
    });
  }

  const existingAttachments = Array.isArray(shipment.attachments)
    ? (shipment.attachments as unknown as Attachment[])
    : [];
  const mergedAttachments = mergeUniqueAttachments(
    existingAttachments,
    savedAttachments
  );
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { attachments: mergedAttachments },
  });
  await indexShipmentVehiclesFromAttachments({
    shipmentId: shipment.id,
    attachments: mergedAttachments,
  });
  await mirrorThreadAttachments({ gmail: input.gmail, threadId: input.message.threadId, shipmentId: shipment.id });

  return {
    shipmentId: shipment.id,
    status: "updated" as const,
    detail: `Đã ghép ${hysParts.length} file HYS vào lô ${shipment.declarationNo ?? shipment.shipmentCode}.`,
  };
}

// "App soi gương Gmail" — Phần A: lấy MỌI đính kèm trong cả chuỗi email (không chỉ ToKhai/HYS) gắn vào
// lô, mỗi đính kèm ghi rõ email nguồn (gmailMessageId) để Phần B đối chiếu xóa. Bỏ qua đính kèm đã có
// (theo email nguồn + tên) để không tải trùng khi chuỗi bị quét lại nhiều lần; bỏ qua email đang ở
// Thùng rác. Lỗi tải một file không làm hỏng cả lô.
async function mirrorThreadAttachments(input: {
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>;
  threadId: string | null | undefined;
  shipmentId: string;
}) {
  if (!input.threadId) return;
  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    select: { attachments: true },
  });
  const existing: Attachment[] = Array.isArray(shipment?.attachments)
    ? (shipment!.attachments as unknown as Attachment[])
    : [];
  // Chống trùng: theo (email nguồn + tên) và theo TÊN file. Dedup theo tên để backfill lô cũ không tải
  // lại file lô đã có sẵn (đính kèm cũ chưa gắn nguồn nên chỉ so được theo tên).
  const present = new Set<string>();
  const presentNames = new Set<string>();
  for (const a of existing) {
    if (a.gmailMessageId) present.add(`${a.gmailMessageId}::${a.name}`);
    presentNames.add(a.name);
  }

  let thread;
  try {
    thread = await input.gmail.users.threads.get({ userId: "me", id: input.threadId, format: "full" });
  } catch (error) {
    console.error(`Không lấy được chuỗi email ${input.threadId} để soi đính kèm:`, error);
    return;
  }

  const cache = new Map<string, Buffer>();
  const added: Attachment[] = [];
  for (const msg of thread.data.messages ?? []) {
    if (!msg.id) continue;
    if ((msg.labelIds ?? []).includes("TRASH")) continue; // email đang bị xóa → không kéo về
    for (const part of collectAttachmentParts(msg.payload)) {
      const key = `${msg.id}::${part.filename}`;
      if (present.has(key) || presentNames.has(part.filename)) continue;
      present.add(key);
      presentNames.add(part.filename);
      try {
        const buffer = await loadGmailAttachment(input.gmail, msg.id, part, cache);
        const saved = await saveUploadedFile(part.filename, buffer);
        added.push({
          ...saved,
          uploadedAt: new Date().toISOString(),
          gmailMessageId: msg.id,
          gmailThreadId: input.threadId,
        });
      } catch (error) {
        console.error(`Không tải được đính kèm ${part.filename} từ email ${msg.id}:`, error);
      }
    }
  }

  if (added.length === 0) return;
  const merged = mergeUniqueAttachments(existing, added);
  await prisma.shipment.update({ where: { id: input.shipmentId }, data: { attachments: merged } });
  await indexShipmentVehiclesFromAttachments({ shipmentId: input.shipmentId, attachments: merged });
}

// "App soi gương Gmail" — Phần B: đối chiếu email nguồn của các đính kèm; email nào Gmail báo 404 hoặc
// đã vào Thùng rác thì GỠ các đính kèm của email đó khỏi lô. TUYỆT ĐỐI không đụng file tự upload (không
// có gmailMessageId). Lỗi mạng/không xác định → giữ nguyên, không xóa. Chạy tối đa 1 lần/giờ cho nhẹ.
let lastReconcileAt = 0;
const RECONCILE_EVERY_MS = 60 * 60 * 1000;
async function reconcileDeletedGmailAttachments(
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>
) {
  if (Date.now() - lastReconcileAt < RECONCILE_EVERY_MS) return { removed: 0, checked: 0 };
  lastReconcileAt = Date.now();

  const shipments = await prisma.shipment.findMany({ select: { id: true, attachments: true } });
  const sourceIds = new Set<string>();
  for (const s of shipments) {
    const atts = Array.isArray(s.attachments) ? (s.attachments as unknown as Attachment[]) : [];
    for (const a of atts) if (a.gmailMessageId) sourceIds.add(a.gmailMessageId);
  }

  const deleted = new Set<string>();
  for (const id of sourceIds) {
    try {
      const res = await gmail.users.messages.get({ userId: "me", id, format: "minimal" });
      if ((res.data.labelIds ?? []).includes("TRASH")) deleted.add(id);
    } catch (error) {
      const status =
        (error as { code?: number; response?: { status?: number } })?.code ??
        (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) deleted.add(id); // chỉ 404 mới coi là đã xóa; lỗi khác thì giữ nguyên
    }
  }
  if (deleted.size === 0) return { removed: 0, checked: sourceIds.size };

  let removed = 0;
  for (const s of shipments) {
    const atts = Array.isArray(s.attachments) ? (s.attachments as unknown as Attachment[]) : [];
    const { kept, removed: gone } = removeAttachmentsFromDeletedMessages(atts, deleted);
    if (gone.length > 0) {
      await prisma.shipment.update({ where: { id: s.id }, data: { attachments: kept } });
      removed += gone.length;
    }
  }
  return { removed, checked: sourceIds.size };
}

// Backfill "app soi gương Gmail" cho các lô CŨ (xử lý trước khi có tính năng): mỗi lần sync soi vài lô
// chưa từng mirror để kéo nốt chứng từ còn thiếu trong chuỗi email, tránh một lần chạy nặng. Đánh dấu đã
// thử trong vòng đời tiến trình để không lặp lại lô mà chuỗi email không có gì thêm.
const backfillAttempted = new Set<string>();
async function backfillThreadAttachments(
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>,
  limit: number
) {
  const sourced = await prisma.processedEmail.findMany({
    where: { shipmentId: { not: null } },
    select: { shipmentId: true, gmailMessageId: true },
    orderBy: { processedAt: "desc" },
  });
  const msgByShipment = new Map<string, string>();
  for (const p of sourced) {
    if (p.shipmentId && !msgByShipment.has(p.shipmentId)) msgByShipment.set(p.shipmentId, p.gmailMessageId);
  }

  const shipments = await prisma.shipment.findMany({ select: { id: true, attachments: true } });
  let done = 0;
  for (const s of shipments) {
    if (done >= limit) break;
    if (backfillAttempted.has(s.id)) continue;
    const atts = Array.isArray(s.attachments) ? (s.attachments as unknown as Attachment[]) : [];
    if (atts.some((a) => a.gmailThreadId)) continue; // đã mirror rồi
    const msgId = msgByShipment.get(s.id);
    if (!msgId) continue; // lô không có email nguồn (tạo tay) → bỏ qua
    backfillAttempted.add(s.id);
    try {
      const msg = await gmail.users.messages.get({ userId: "me", id: msgId, format: "minimal" });
      await mirrorThreadAttachments({ gmail, threadId: msg.data.threadId, shipmentId: s.id });
      done += 1;
    } catch (error) {
      console.error(`Backfill soi đính kèm lô ${s.id} lỗi:`, error);
    }
  }
  return done;
}

async function syncDeclarationFromMessage(input: {
  gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>;
  messageId: string;
  threadId: string | null;
  parsed: ParsedDeclaration;
  attachmentParts: AttachmentPart[];
  attachmentCache: Map<string, Buffer>;
  subject: string | null;
  user: NonNullable<Awaited<ReturnType<typeof getSyncActor>>>;
}) {
  const {
    gmail,
    messageId,
    threadId,
    parsed,
    attachmentParts,
    attachmentCache,
    subject,
    user,
  } = input;
  const existing = await findMatchingShipment(parsed);
  const isCleared = attachmentParts.some((part) =>
    isClearanceDecisionFilename(part.filename)
  );
  const statusNote = isCleared
    ? " Trạng thái: Thông quan."
    : parsed.hasStorageInstruction
      ? " Trạng thái: Đưa hàng về bảo quản."
      : "";

  const rawExistingAttachments: Attachment[] =
    existing && Array.isArray(existing.attachments)
      ? (existing.attachments as unknown as Attachment[])
      : [];
  const knownDeclarationNumbers = [
    existing?.declarationNo,
    ...(existing && Array.isArray(existing.declarationBranches)
      ? (existing.declarationBranches as unknown[]).filter(
          (number): number is string => typeof number === "string"
        )
      : []),
    parsed.firstDeclarationNo,
    parsed.declarationNo,
  ].filter((number): number is string => Boolean(number));

  // Older sync versions stored every workbook from an email on the first shipment. Reprocessing
  // the message now removes files from unrelated declaration families before merging the right set.
  const existingAttachments = rawExistingAttachments.filter((attachment) =>
    attachmentBelongsToDeclarationFamilies(attachment.name, knownDeclarationNumbers)
  );
  const removedWrongClearance = rawExistingAttachments.some(
    (attachment) =>
      !attachmentBelongsToDeclarationFamilies(
        attachment.name,
        knownDeclarationNumbers
      ) && isClearanceDecisionFilename(attachment.name)
  );

  const savedAttachments: Attachment[] = [];
  for (const part of attachmentParts) {
    const buffer = await loadGmailAttachment(
      gmail,
      messageId,
      part,
      attachmentCache
    );
    const saved = await saveUploadedFile(part.filename, buffer);
    savedAttachments.push({
      ...saved,
      uploadedAt: new Date().toISOString(),
      gmailMessageId: messageId,
      gmailThreadId: threadId ?? undefined,
    });
  }

  if (existing) {
    const mergedAttachments = mergeUniqueAttachments(
      existingAttachments,
      savedAttachments
    );
    const correctedCurrentStatus =
      existing.status === "Thông quan" && removedWrongClearance && !isCleared
        ? parsed.hasStorageInstruction
          ? "Đưa hàng về bảo quản"
          : "Đang làm thủ tục"
        : existing.status;
    const nextStatus = resolveSyncedShipmentStatus(correctedCurrentStatus, {
      isCleared,
      hasStorageInstruction: parsed.hasStorageInstruction,
    });

    let declarationBranches: string[] = Array.isArray(existing.declarationBranches)
      ? (existing.declarationBranches as unknown as string[])
      : [existing.declarationNo ?? parsed.declarationNo];
    if (parsed.firstDeclarationNo) {
      declarationBranches = mergeDeclarationBranch(
        declarationBranches,
        parsed.firstDeclarationNo
      );
    }
    declarationBranches = mergeDeclarationBranch(
      declarationBranches,
      parsed.declarationNo
    );
    const canonicalDeclarationNo = declarationBranches[0];

    await prisma.shipment.update({
      where: { id: existing.id },
      data: {
        declarationNo: canonicalDeclarationNo,
        declarationBranches,
        channel: parsed.channel ?? existing.channel,
        customsType: parsed.customsType ?? existing.customsType,
        customsOffice: parsed.customsOffice ?? existing.customsOffice,
        declarationDate: parsed.declarationDate ?? existing.declarationDate,
        invoiceNo: parsed.invoiceNo ?? existing.invoiceNo,
        goodsName: subject ?? existing.goodsName,
        port: parsed.port ?? existing.port,
        consultationDate: parsed.consultationDate ?? existing.consultationDate,
        status: nextStatus,
        attachments: mergedAttachments,
      },
    });
    await indexShipmentVehiclesFromAttachments({
      shipmentId: existing.id,
      attachments: mergedAttachments,
    });
    await mirrorThreadAttachments({ gmail, threadId, shipmentId: existing.id });
    await Promise.all([
      applyCostPresetsToShipment({ shipmentId: existing.id, userId: user.id }),
      ensureShipmentWorkflowTasks({
        shipmentId: existing.id,
        createdByUserId: user.id,
      }),
      ensureConsultationTask({ shipmentId: existing.id, createdByUserId: user.id }),
    ]);

    return {
      shipmentId: existing.id,
      status: "updated" as const,
      detail: `Cập nhật lô hàng có số tờ khai ${parsed.declarationNo}.${statusNote}`,
    };
  }

  let newBranches: string[] = [];
  if (parsed.firstDeclarationNo) {
    newBranches = mergeDeclarationBranch(
      newBranches,
      parsed.firstDeclarationNo
    );
  }
  newBranches = mergeDeclarationBranch(newBranches, parsed.declarationNo);
  const canonicalDeclarationNo = newBranches[0];
  const customerId = await findOrCreateCustomer(parsed);

  const shipment = await prisma.shipment.create({
    data: {
      shipmentCode: generateShipmentCode(),
      customerName: parsed.customerName ?? "Chưa xác định",
      customerId,
      taxCode: parsed.taxCode,
      declarationNo: canonicalDeclarationNo,
      declarationBranches: newBranches,
      declarationDate: parsed.declarationDate,
      invoiceNo: parsed.invoiceNo,
      customsType: parsed.customsType,
      port: parsed.port,
      goodsName: subject ?? parsed.goodsName,
      channel: parsed.channel,
      customsOffice: parsed.customsOffice,
      consultationDate: parsed.consultationDate,
      status: isCleared
        ? "Thông quan"
        : parsed.hasStorageInstruction
          ? "Đưa hàng về bảo quản"
          : undefined,
      attachments: mergeUniqueAttachments(savedAttachments),
    },
  });
  await indexShipmentVehiclesFromAttachments({
    shipmentId: shipment.id,
    attachments: mergeUniqueAttachments(savedAttachments),
  });
  await mirrorThreadAttachments({ gmail, threadId, shipmentId: shipment.id });
  await Promise.all([
    applyCostPresetsToShipment({ shipmentId: shipment.id, userId: user.id }),
    ensureShipmentWorkflowTasks({
      shipmentId: shipment.id,
      createdByUserId: user.id,
    }),
    ensureConsultationTask({ shipmentId: shipment.id, createdByUserId: user.id }),
  ]);
  await notifyNewShipmentAssignees({
    shipmentId: shipment.id,
    actorUserId: user.id,
  });

  return {
    shipmentId: shipment.id,
    status: "created" as const,
    detail: `Tạo lô hàng mới từ số tờ khai ${parsed.declarationNo}.${statusNote}`,
  };
}

async function runGmailSync(gmail: NonNullable<Awaited<ReturnType<typeof getAuthorizedGmailClient>>>, user: NonNullable<Awaited<ReturnType<typeof getSyncActor>>>) {
    // Set, not array: Gmail's search pagination isn't guaranteed collision-free across pages (seen
    // in practice returning the same message ID twice), and a duplicate ID in this list would hit
    // the ProcessedEmail unique constraint the second time it's processed.
    const messageIdSet = new Set<string>();
    let pageToken: string | undefined;
    let scanned = 0;

    do {
      const listRes = await gmail.users.messages.list({
        userId: "me",
        // Gmail's `filename:` operator requires an exact token match, not a substring — "ToKhai" alone
        // never matches "ToKhaiHQ7N_....xlsx". Search the literal filename prefixes instead (verified
        // against the real mailbox); the isDeclarationFile() check below is the actual attachment filter.
        q: "has:attachment (ToKhaiHQ7N OR ToKhaiHQ7X OR HYS OR dinhkem)",
        maxResults: 100,
        pageToken,
      });

      const pageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
      scanned += pageIds.length;
      const processedIds = new Set(
        (await prisma.processedEmail.findMany({
          where: { gmailMessageId: { in: pageIds } },
          select: { gmailMessageId: true, detail: true },
        }))
          .filter((email) => (email.detail ?? "").startsWith(SHIPMENT_SYNC_MARKER))
          .map((email) => email.gmailMessageId)
      );

      for (const id of pageIds) {
        if (messageIdSet.has(id)) continue;
        if (!processedIds.has(id)) messageIdSet.add(id);
      }

      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken && messageIdSet.size < NEW_MESSAGES_PER_SYNC);

    const messageIds = [...messageIdSet];

    const results: { messageId: string; status: string; detail: string }[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const messageId of messageIds) {
      try {
        const messageRes = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
        const message = messageRes.data;
        const attachmentParts = collectAttachmentParts(message.payload);
        const declarationParts = attachmentParts.filter((part) =>
          isDeclarationFile(part.filename)
        );

        if (declarationParts.length === 0) {
          const outcome = await syncSupplementalHysFromMessage({
            gmail,
            messageId,
            message,
            attachmentParts,
          });
          if (outcome.status === "updated") updated++;
          else skipped++;
          results.push({ messageId, status: outcome.status, detail: outcome.detail });
          await recordProcessedEmail({
            gmailMessageId: messageId,
            shipmentId: outcome.shipmentId,
            status: outcome.status,
            detail: outcome.detail,
          });
          continue;
        }

        const attachmentCache = new Map<string, Buffer>();
        const parsedParts: { part: AttachmentPart; parsed: ParsedDeclaration }[] = [];
        const unreadableFiles: string[] = [];
        for (const part of declarationParts) {
          const buffer = await loadGmailAttachment(
            gmail,
            messageId,
            part,
            attachmentCache
          );
          const parsed = await parseTokhaiExcel(buffer);
          if (parsed) parsedParts.push({ part, parsed });
          else unreadableFiles.push(part.filename);
        }

        if (parsedParts.length === 0) {
          skipped++;
          const detail = `Không đọc được số tờ khai trong ${unreadableFiles.length} file ToKhai đính kèm.`;
          results.push({ messageId, status: "skipped", detail });
          await recordProcessedEmail({
            gmailMessageId: messageId,
            status: "skipped",
            detail,
          });
          continue;
        }

        const rawSubject = getSubject(message);
        const subject = rawSubject ? extractGoodsName(rawSubject) : null;

        // One email may contain several printouts for the same declaration (for example the
        // declaration and QDTQ decision). Process that declaration once, with all of its own files.
        const groups = new Map<
          string,
          { parsed: ParsedDeclaration; parts: AttachmentPart[] }
        >();
        for (const entry of parsedParts) {
          const group = groups.get(entry.parsed.declarationNo);
          if (group) group.parts.push(entry.part);
          else {
            groups.set(entry.parsed.declarationNo, {
              parsed: entry.parsed,
              parts: [entry.part],
            });
          }
        }

        const parsedDeclarationByAttachmentId = new Map(
          parsedParts.map(({ part, parsed }) => [
            part.attachmentId,
            parsed.declarationNo,
          ])
        );
        const messageDetails: string[] = [];
        let firstShipmentId: string | undefined;
        let messageCreated = 0;

        for (const group of groups.values()) {
          const matchingParts = attachmentParts.filter((part) =>
            attachmentMatchesDeclaration({
              filename: part.filename,
              parsedDeclarationNo:
                parsedDeclarationByAttachmentId.get(part.attachmentId),
              targetDeclarationNo: group.parsed.declarationNo,
              declarationCount: groups.size,
            })
          );
          const outcome = await syncDeclarationFromMessage({
            gmail,
            messageId,
            threadId: message.threadId ?? null,
            parsed: group.parsed,
            attachmentParts: matchingParts,
            attachmentCache,
            subject,
            user,
          });
          firstShipmentId ??= outcome.shipmentId;
          if (outcome.status === "created") {
            created++;
            messageCreated++;
          }
          else updated++;
          messageDetails.push(outcome.detail);
          results.push({
            messageId,
            status: outcome.status,
            detail: outcome.detail,
          });
        }

        if (unreadableFiles.length > 0) {
          messageDetails.push(
            `Bỏ qua ${unreadableFiles.length} file không đọc được: ${unreadableFiles.join(", ")}.`
          );
        }
        await recordProcessedEmail({
          gmailMessageId: messageId,
          shipmentId: firstShipmentId,
          status: messageCreated > 0 ? "created" : "updated",
          detail: messageDetails.join(" "),
        });
      } catch (error) {
        // Deliberately does NOT write a ProcessedEmail row here: this is an unexpected failure
        // (network hiccup, transient DB error, etc.), not "this email will never be valid" — leaving
        // it unmarked means the next sync run retries it instead of skipping it forever.
        errors++;
        const detail = error instanceof Error ? error.message : "Lỗi không xác định.";
        console.error(`Gmail sync failed for message ${messageId}:`, error);
        results.push({ messageId, status: "error", detail });
      }
    }

    // Also fix records affected before the attachment-order bug was corrected.
    updated += await reconcileClearanceStatuses();

    let invoiceSummary: VendorInvoiceSyncSummary = {
      scanned: 0,
      created: 0,
      matched: 0,
      unmatched: 0,
      needsReview: 0,
      skipped: 0,
      errors: 0,
    };
    try {
      invoiceSummary = await syncVendorInvoices(gmail);
    } catch (invoiceError) {
      invoiceSummary.errors++;
      console.error("Gmail vendor-invoice sync failed:", invoiceError);
    }

    try {
      // This reconciliation used to run every time every browser polled the notification bell.
      // Running it once per scheduled sync keeps alerts within the same five-minute SLA without
      // making ordinary notification reads scan every shipment and notification row.
      await syncMissingActualCostAlerts();
    } catch (notificationError) {
      console.error("Missing-cost alert reconciliation failed:", notificationError);
    }

    try {
      await backfillShipmentVehicleIndex(25);
    } catch (vehicleIndexError) {
      console.error("Vehicle workbook backfill failed:", vehicleIndexError);
    }

    try {
      // "App soi gương Gmail" — backfill lô cũ: mỗi lần sync soi vài lô để kéo nốt chứng từ còn thiếu.
      const filled = await backfillThreadAttachments(gmail, 15);
      if (filled > 0) console.log(`[gmail-mirror] Backfill soi đính kèm ${filled} lô.`);
    } catch (backfillError) {
      console.error("Backfill soi đính kèm Gmail thất bại:", backfillError);
    }

    try {
      // "App soi gương Gmail" — Phần B: gỡ đính kèm của các email đã bị xóa/vào Thùng rác. Tự giới hạn
      // 1 lần/giờ bên trong hàm; chỉ đụng đính kèm có nguồn Gmail, không đụng file tự upload.
      const rec = await reconcileDeletedGmailAttachments(gmail);
      if (rec.removed > 0) console.log(`[gmail-mirror] Đã gỡ ${rec.removed} đính kèm của email đã xóa.`);
    } catch (reconcileError) {
      console.error("Đối chiếu đính kèm Gmail đã xóa thất bại:", reconcileError);
    }

    return {
      scanned,
      newlyFound: messageIds.length,
      created,
      updated,
      skipped,
      errors,
      invoicesScanned: invoiceSummary.scanned,
      invoicesCreated: invoiceSummary.created,
      invoicesMatched: invoiceSummary.matched,
      invoicesUnmatched: invoiceSummary.unmatched,
      invoicesNeedsReview: invoiceSummary.needsReview,
      invoiceErrors: invoiceSummary.errors,
      results,
    };
}

export async function POST(request: NextRequest) {
  let ownsSyncLock = false;
  const isCron = (request.headers.get("authorization") ?? "").startsWith("Bearer ");
  try {
    const user = await getSyncActor(request);
    if (!user) return apiError("Chưa đăng nhập hoặc khóa tác vụ máy chủ không hợp lệ.", 401);
    if (user.role !== "ADMIN") return apiError("Chỉ Admin mới được đồng bộ Gmail.", 403);

    const gmail = await getAuthorizedGmailClient();
    if (!gmail) {
      return apiError("Chưa kết nối Gmail. Hãy bấm \"Kết nối Gmail\" trước.", 400);
    }
    try {
      await verifyGmailClient(gmail);
    } catch (error) {
      if (isExpiredGmailTokenError(error)) {
        return apiError("Phiên Gmail đã hết hạn hoặc bị thu hồi. Hãy kết nối lại Gmail.", 401);
      }
      console.error("Gmail credential verification failed:", error);
      return apiError("Không thể xác thực Gmail lúc này. Vui lòng thử lại.", 502);
    }

    if (syncIsRunning()) {
      return apiSuccess({
        scanned: 0,
        newlyFound: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        invoicesScanned: 0,
        invoicesCreated: 0,
        invoicesMatched: 0,
        invoicesUnmatched: 0,
        invoicesNeedsReview: 0,
        invoiceErrors: 0,
        results: [],
        inProgress: true,
      }, 202);
    }
    syncStartedAt = Date.now();
    ownsSyncLock = true;

    // Cron (gọi bằng Bearer CRON_SECRET) chạy ngầm và trả 202 ngay để dịch vụ cron timeout ngắn
    // (vd cron-job.org 30s) không hiểu nhầm là lỗi; server Hostinger là tiến trình lâu dài nên
    // tác vụ nền vẫn chạy tới khi xong. UI vẫn await để hiện kết quả đồng bộ như cũ.
    if (isCron) {
      void runGmailSync(gmail, user)
        .catch((error) => console.error("Background Gmail sync failed:", error))
        .finally(() => {
          syncStartedAt = null;
        });
      ownsSyncLock = false; // tác vụ nền tự nhả khóa; finally ngoài không đụng tới
      return apiSuccess({ started: true, inProgress: true }, 202);
    }

    return apiSuccess(await runGmailSync(gmail, user));
  } catch (error) {
    console.error("POST /api/gmail/sync failed:", error);
    return apiError("Đồng bộ email thất bại.", 500);
  } finally {
    if (ownsSyncLock) syncStartedAt = null;
  }
}
