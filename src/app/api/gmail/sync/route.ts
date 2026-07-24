import type { gmail_v1 } from "googleapis";
import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getAuthorizedGmailClient } from "@/lib/google";
import { parseTokhaiExcel, type ParsedDeclaration } from "@/lib/tokhai-parser";
import { saveUploadedFile } from "@/lib/save-upload";
import { prisma } from "@/lib/prisma";
import {
  generateShipmentCode,
  isClearanceDecisionFilename,
  mergeUniqueAttachments,
  mergeDeclarationBranch,
  sharesDeclarationFamily,
  resolveSyncedShipmentStatus,
  type Attachment,
} from "@/lib/shipment-constants";
import { applyCostPresetsToShipment } from "@/lib/cost-presets";
import { ensureShipmentWorkflowTasks } from "@/lib/shipment-workflow";
import { syncVendorInvoices, type VendorInvoiceSyncSummary } from "@/lib/vendor-invoice-sync";
import { notifyNewShipmentAssignees, syncMissingActualCostAlerts } from "@/lib/notifications";

// How many *new* (not-yet-processed) messages one sync call takes on. Gmail returns matches
// newest-first, and every call starts pagination from page 1 — so once the newest ~500 are already
// processed, capping by raw messages-seen would keep re-fetching the same done page forever and
// never reach older backlog. Capping by new-message count instead means every run makes progress
// until the whole mailbox is caught up, however many pages that takes.
const NEW_MESSAGES_PER_SYNC = 150;
let syncInProgress = false;

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
  const { gmailMessageId, ...rest } = data;
  await prisma.processedEmail.upsert({
    where: { gmailMessageId },
    create: data,
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
        q: "has:attachment (ToKhaiHQ7N OR ToKhaiHQ7X)",
        maxResults: 100,
        pageToken,
      });

      const pageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
      scanned += pageIds.length;
      const processedIds = new Set(
        (await prisma.processedEmail.findMany({
          where: { gmailMessageId: { in: pageIds } },
          select: { gmailMessageId: true },
        })).map((email) => email.gmailMessageId)
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
        const declarationPart = attachmentParts.find((p) => isDeclarationFile(p.filename));

        if (!declarationPart) {
          skipped++;
          const detail = "Không tìm thấy file tờ khai (ToKhai) đính kèm trong email.";
          results.push({ messageId, status: "skipped", detail });
          await recordProcessedEmail({ gmailMessageId: messageId, status: "skipped", detail });
          continue;
        }

        const declarationAttachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: declarationPart.attachmentId,
        });
        const declarationBuffer = Buffer.from(declarationAttachment.data.data ?? "", "base64url");
        const parsed = await parseTokhaiExcel(declarationBuffer);
        // The message commonly contains several ToKhai workbooks. The parser can use any declaration
        // printout, but clearance is true when *any* attachment is the QDTQ decision—not only when the
        // first workbook returned by Gmail happens to be QDTQ.
        const isCleared = attachmentParts.some((part) => isClearanceDecisionFilename(part.filename));
        const rawSubject = getSubject(message);
        const subject = rawSubject ? extractGoodsName(rawSubject) : null;

        if (!parsed) {
          skipped++;
          const detail = `File "${declarationPart.filename}" không đọc được số tờ khai — có thể không phải bản in tờ khai hợp lệ.`;
          results.push({ messageId, status: "skipped", detail });
          await recordProcessedEmail({ gmailMessageId: messageId, status: "skipped", detail });
          continue;
        }

        const existing = await findMatchingShipment(parsed);
        const statusNote = isCleared
          ? " Trạng thái: Thông quan."
          : parsed.hasStorageInstruction
            ? " Trạng thái: Đưa hàng về bảo quản."
            : "";

        const existingAttachments: Attachment[] =
          existing && Array.isArray(existing.attachments) ? (existing.attachments as unknown as Attachment[]) : [];
        const existingNames = new Set(existingAttachments.map((a) => a.name));

        // Re-running sync (e.g. after a bug fix) re-fetches the same message — skip attachments
        // already saved for this shipment instead of writing duplicate files with duplicate entries.
        const savedAttachments: Attachment[] = [];
        for (const part of attachmentParts) {
          if (existingNames.has(part.filename)) continue;
          const attachmentRes = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId,
            id: part.attachmentId,
          });
          const buffer = Buffer.from(attachmentRes.data.data ?? "", "base64url");
          const saved = await saveUploadedFile(part.filename, buffer);
          savedAttachments.push({ ...saved, uploadedAt: new Date().toISOString() });
        }

        if (existing) {
          const mergedAttachments = mergeUniqueAttachments(existingAttachments, savedAttachments);

          const nextStatus = resolveSyncedShipmentStatus(existing.status, {
            isCleared,
            hasStorageInstruction: parsed.hasStorageInstruction,
          });

          let declarationBranches: string[] = Array.isArray(existing.declarationBranches)
            ? (existing.declarationBranches as unknown as string[])
            : [existing.declarationNo ?? parsed.declarationNo];
          if (parsed.firstDeclarationNo) {
            declarationBranches = mergeDeclarationBranch(declarationBranches, parsed.firstDeclarationNo);
          }
          declarationBranches = mergeDeclarationBranch(declarationBranches, parsed.declarationNo);
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
          await Promise.all([
            applyCostPresetsToShipment({ shipmentId: existing.id, userId: user.id }),
            ensureShipmentWorkflowTasks({ shipmentId: existing.id, createdByUserId: user.id }),
          ]);

          updated++;
          const detail = `Cập nhật lô hàng có số tờ khai ${parsed.declarationNo}.${statusNote}`;
          results.push({ messageId, status: "updated", detail });
          await recordProcessedEmail({ gmailMessageId: messageId, shipmentId: existing.id, status: "updated", detail });
        } else {
          let newBranches: string[] = [];
          if (parsed.firstDeclarationNo) {
            newBranches = mergeDeclarationBranch(newBranches, parsed.firstDeclarationNo);
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
              status: isCleared ? "Thông quan" : parsed.hasStorageInstruction ? "Đưa hàng về bảo quản" : undefined,
              attachments: mergeUniqueAttachments(savedAttachments),
            },
          });
          await Promise.all([
            applyCostPresetsToShipment({ shipmentId: shipment.id, userId: user.id }),
            ensureShipmentWorkflowTasks({ shipmentId: shipment.id, createdByUserId: user.id }),
          ]);
          await notifyNewShipmentAssignees({ shipmentId: shipment.id, actorUserId: user.id });

          created++;
          const detail = `Tạo lô hàng mới từ số tờ khai ${parsed.declarationNo}.${statusNote}`;
          results.push({ messageId, status: "created", detail });
          await recordProcessedEmail({ gmailMessageId: messageId, shipmentId: shipment.id, status: "created", detail });
        }
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

    if (syncInProgress) {
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
    syncInProgress = true;
    ownsSyncLock = true;

    // Cron (gọi bằng Bearer CRON_SECRET) chạy ngầm và trả 202 ngay để dịch vụ cron timeout ngắn
    // (vd cron-job.org 30s) không hiểu nhầm là lỗi; server Hostinger là tiến trình lâu dài nên
    // tác vụ nền vẫn chạy tới khi xong. UI vẫn await để hiện kết quả đồng bộ như cũ.
    if (isCron) {
      void runGmailSync(gmail, user)
        .catch((error) => console.error("Background Gmail sync failed:", error))
        .finally(() => {
          syncInProgress = false;
        });
      ownsSyncLock = false; // tác vụ nền tự nhả khóa; finally ngoài không đụng tới
      return apiSuccess({ started: true, inProgress: true }, 202);
    }

    return apiSuccess(await runGmailSync(gmail, user));
  } catch (error) {
    console.error("POST /api/gmail/sync failed:", error);
    return apiError("Đồng bộ email thất bại.", 500);
  } finally {
    if (ownsSyncLock) syncInProgress = false;
  }
}
