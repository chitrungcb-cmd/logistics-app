import type { gmail_v1 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { saveUploadedFile } from "@/lib/save-upload";
import {
  isR2StorageConfigured,
  privateObjectExistsInR2,
  privateObjectKeyFromUrl,
} from "@/lib/private-storage";
import { mergeUniqueAttachments, type Attachment } from "@/lib/shipment-constants";

type GmailAttachmentPart = {
  filename: string;
  attachmentId: string | null;
  inlineData: string | null;
};

type StoredReference = {
  name: string;
  url: string;
};

type BackfillCandidate = {
  gmailMessageId: string;
  shipmentIds: Set<string>;
  invoiceIds: Set<string>;
  references: Map<string, StoredReference>;
};

type SavedAttachment = {
  name: string;
  url: string;
};

const BACKFILL_MARKER_PREFIX = "__system_r2_gmail_attachment_v1__:";
const BACKFILL_DONE_ID = `${BACKFILL_MARKER_PREFIX}complete`;
const MAX_SOURCE_MESSAGES_INSPECTED_PER_RUN = 25;

export type GmailR2BackfillSummary = {
  done: boolean;
  sourceMessagesRemaining: number;
  candidatesFound: number;
  messagesProcessed: number;
  filesUploaded: number;
  shipmentRowsUpdated: number;
  invoiceRowsUpdated: number;
  errors: number;
  errorMessages: string[];
};

function backfillMarkerId(gmailMessageId: string) {
  return `${BACKFILL_MARKER_PREFIX}${gmailMessageId}`;
}

async function markBackfilled(gmailMessageId: string, detail: string) {
  const markerId = backfillMarkerId(gmailMessageId);
  await prisma.processedEmail.upsert({
    where: { gmailMessageId: markerId },
    create: { gmailMessageId: markerId, status: "r2_backfilled", detail },
    update: { status: "r2_backfilled", detail },
  });
}

async function markBackfillComplete() {
  await prisma.processedEmail.upsert({
    where: { gmailMessageId: BACKFILL_DONE_ID },
    create: {
      gmailMessageId: BACKFILL_DONE_ID,
      status: "r2_backfill_complete",
      detail: "Đã phục hồi các tệp Gmail được tham chiếu trong cơ sở dữ liệu sang Cloudflare R2.",
    },
    update: {
      status: "r2_backfill_complete",
      detail: "Đã phục hồi các tệp Gmail được tham chiếu trong cơ sở dữ liệu sang Cloudflare R2.",
    },
  });
}

function collectAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined): GmailAttachmentPart[] {
  if (!part) return [];
  const found: GmailAttachmentPart[] = [];
  if (part.filename && (part.body?.attachmentId || part.body?.data)) {
    found.push({
      filename: part.filename,
      attachmentId: part.body?.attachmentId ?? null,
      inlineData: part.body?.data ?? null,
    });
  }
  for (const child of part.parts ?? []) found.push(...collectAttachmentParts(child));
  return found;
}

async function loadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  part: GmailAttachmentPart
) {
  if (part.inlineData) return Buffer.from(part.inlineData, "base64url");
  if (!part.attachmentId) return Buffer.alloc(0);
  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: part.attachmentId,
  });
  return Buffer.from(response.data.data ?? "", "base64url");
}

function shipmentAttachments(value: unknown): Attachment[] {
  return Array.isArray(value) ? (value as Attachment[]) : [];
}

function storedReferenceName(url: string, fallback: string) {
  try {
    const parsed = new URL(url, "https://private.invalid");
    const displayName = parsed.searchParams.get("name");
    if (displayName) return displayName;
  } catch {
    // Fall back to the database display name below.
  }
  return fallback;
}

function addCandidate(
  candidates: Map<string, BackfillCandidate>,
  gmailMessageId: string,
  reference: StoredReference,
  relation: { shipmentId?: string; invoiceId?: string }
) {
  let candidate = candidates.get(gmailMessageId);
  if (!candidate) {
    candidate = {
      gmailMessageId,
      shipmentIds: new Set(),
      invoiceIds: new Set(),
      references: new Map(),
    };
    candidates.set(gmailMessageId, candidate);
  }
  if (relation.shipmentId) candidate.shipmentIds.add(relation.shipmentId);
  if (relation.invoiceId) candidate.invoiceIds.add(relation.invoiceId);
  candidate.references.set(reference.url, reference);
}

async function missingFromR2(url: string, cache: Map<string, Promise<boolean>>) {
  const key = privateObjectKeyFromUrl(url);
  // Legacy local-disk URLs are also recoverable from Gmail and must be replaced with an R2 URL.
  if (!key) return true;
  let existing = cache.get(key);
  if (!existing) {
    existing = privateObjectExistsInR2(key);
    cache.set(key, existing);
  }
  return !(await existing);
}

type CandidateSearchResult = {
  candidates: BackfillCandidate[];
  sourceMessagesRemaining: number;
};

async function findCandidates(limit: number): Promise<CandidateSearchResult> {
  const [processed, backfillMarkers, shipments, invoices] = await Promise.all([
    prisma.processedEmail.findMany({
      where: { shipmentId: { not: null } },
      select: { shipmentId: true, gmailMessageId: true },
      orderBy: { processedAt: "desc" },
    }),
    prisma.processedEmail.findMany({
      where: { gmailMessageId: { startsWith: BACKFILL_MARKER_PREFIX } },
      select: { gmailMessageId: true },
    }),
    prisma.shipment.findMany({
      select: { id: true, attachments: true },
      orderBy: [{ declarationDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.vendorInvoice.findMany({
      select: {
        id: true,
        gmailMessageId: true,
        attachmentName: true,
        attachmentUrl: true,
        xmlUrl: true,
        pdfUrl: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const fallbackMessageByShipment = new Map<string, string>();
  for (const row of processed) {
    if (row.shipmentId && !fallbackMessageByShipment.has(row.shipmentId)) {
      fallbackMessageByShipment.set(row.shipmentId, row.gmailMessageId);
    }
  }

  const candidates = new Map<string, BackfillCandidate>();

  for (const shipment of shipments) {
    const fallbackMessageId = fallbackMessageByShipment.get(shipment.id);
    for (const attachment of shipmentAttachments(shipment.attachments)) {
      const messageId = attachment.gmailMessageId || fallbackMessageId;
      if (!messageId || !attachment.url) continue;
      addCandidate(
        candidates,
        messageId,
        { name: attachment.name, url: attachment.url },
        { shipmentId: shipment.id }
      );
    }
  }

  for (const invoice of invoices) {
    const references = [
      { name: invoice.attachmentName, url: invoice.attachmentUrl },
      invoice.xmlUrl
        ? { name: storedReferenceName(invoice.xmlUrl, "invoice.xml"), url: invoice.xmlUrl }
        : null,
      invoice.pdfUrl
        ? { name: storedReferenceName(invoice.pdfUrl, invoice.attachmentName), url: invoice.pdfUrl }
        : null,
    ].filter((reference): reference is StoredReference => Boolean(reference?.url));

    for (const reference of references) {
      if (!invoice.gmailMessageId) continue;
      addCandidate(candidates, invoice.gmailMessageId, reference, { invoiceId: invoice.id });
    }
  }

  const completedMessageIds = new Set(
    backfillMarkers
      .map((row) => row.gmailMessageId.slice(BACKFILL_MARKER_PREFIX.length))
      .filter((messageId) => messageId && messageId !== "complete")
  );
  const pending = [...candidates.values()].filter(
    (candidate) => !completedMessageIds.has(candidate.gmailMessageId)
  );
  const selected: BackfillCandidate[] = [];
  const existenceCache = new Map<string, Promise<boolean>>();
  let sourceMessagesRemaining = pending.length;

  for (const candidate of pending.slice(0, MAX_SOURCE_MESSAGES_INSPECTED_PER_RUN)) {
    const missingReferences = new Map<string, StoredReference>();
    for (const [url, reference] of candidate.references) {
      if (await missingFromR2(url, existenceCache)) missingReferences.set(url, reference);
    }

    if (missingReferences.size === 0) {
      await markBackfilled(candidate.gmailMessageId, "Tệp đã có sẵn trên R2.");
      sourceMessagesRemaining--;
      continue;
    }

    selected.push({ ...candidate, references: missingReferences });
    if (selected.length >= limit) break;
  }

  return { candidates: selected, sourceMessagesRemaining };
}

function extension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function chooseSavedAttachment(
  saved: SavedAttachment[],
  preferredName: string,
  preferredExtension?: string
) {
  const exact = saved.find(
    (attachment) => attachment.name.toLowerCase() === preferredName.toLowerCase()
  );
  if (exact) return exact;
  if (preferredExtension) {
    return saved.find((attachment) => extension(attachment.name) === preferredExtension) ?? null;
  }
  return null;
}

async function updateShipmentReferences(input: {
  shipmentId: string;
  gmailMessageId: string;
  gmailThreadId: string | null | undefined;
  missingUrls: Set<string>;
  saved: SavedAttachment[];
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    select: { attachments: true },
  });
  if (!shipment) return false;

  let changed = false;
  const next = shipmentAttachments(shipment.attachments).map((attachment) => {
    if (!input.missingUrls.has(attachment.url)) return attachment;
    if (attachment.gmailMessageId && attachment.gmailMessageId !== input.gmailMessageId) {
      return attachment;
    }
    const replacement = chooseSavedAttachment(
      input.saved,
      attachment.name,
      extension(attachment.name)
    );
    if (!replacement) return attachment;
    changed = true;
    return {
      ...attachment,
      url: replacement.url,
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId ?? attachment.gmailThreadId,
    };
  });

  if (!changed) return false;
  await prisma.shipment.update({
    where: { id: input.shipmentId },
    data: { attachments: mergeUniqueAttachments(next) },
  });
  return true;
}

async function updateInvoiceReferences(input: {
  invoiceId: string;
  missingUrls: Set<string>;
  saved: SavedAttachment[];
}) {
  const invoice = await prisma.vendorInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) return false;

  const data: { attachmentUrl?: string; xmlUrl?: string; pdfUrl?: string } = {};
  if (input.missingUrls.has(invoice.attachmentUrl)) {
    const replacement = chooseSavedAttachment(
      input.saved,
      invoice.attachmentName,
      extension(invoice.attachmentName)
    );
    if (replacement) data.attachmentUrl = replacement.url;
  }
  if (invoice.xmlUrl && input.missingUrls.has(invoice.xmlUrl)) {
    const replacement = chooseSavedAttachment(
      input.saved,
      storedReferenceName(invoice.xmlUrl, "invoice.xml"),
      "xml"
    );
    if (replacement) data.xmlUrl = replacement.url;
  }
  if (invoice.pdfUrl && input.missingUrls.has(invoice.pdfUrl)) {
    const replacement = chooseSavedAttachment(
      input.saved,
      storedReferenceName(invoice.pdfUrl, invoice.attachmentName),
      "pdf"
    );
    if (replacement) data.pdfUrl = replacement.url;
  }

  if (Object.keys(data).length === 0) return false;
  await prisma.vendorInvoice.update({ where: { id: input.invoiceId }, data });
  return true;
}

async function stillReferencesMissingUrls(candidate: BackfillCandidate) {
  const missingUrls = new Set(candidate.references.keys());
  const [shipments, invoices] = await Promise.all([
    candidate.shipmentIds.size > 0
      ? prisma.shipment.findMany({
          where: { id: { in: [...candidate.shipmentIds] } },
          select: { attachments: true },
        })
      : [],
    candidate.invoiceIds.size > 0
      ? prisma.vendorInvoice.findMany({
          where: { id: { in: [...candidate.invoiceIds] } },
          select: { attachmentUrl: true, xmlUrl: true, pdfUrl: true },
        })
      : [],
  ]);

  if (
    shipments.some((shipment) =>
      shipmentAttachments(shipment.attachments).some((attachment) => missingUrls.has(attachment.url))
    )
  ) {
    return true;
  }
  return invoices.some((invoice) =>
    [invoice.attachmentUrl, invoice.xmlUrl, invoice.pdfUrl].some(
      (url) => Boolean(url) && missingUrls.has(url as string)
    )
  );
}

/**
 * Rehydrates a tiny idempotent batch of legacy attachment bytes from Gmail into R2. The scheduled
 * sync invokes this after it has handled new mail. Persistent marker rows ensure an old source email
 * is inspected at most once and the migration becomes a single cheap completion lookup when done.
 */
export async function backfillLegacyGmailAttachmentsToR2(
  gmail: gmail_v1.Gmail,
  limit = 3
): Promise<GmailR2BackfillSummary> {
  if (!isR2StorageConfigured()) throw new Error("Cloudflare R2 is not configured.");

  const alreadyComplete = await prisma.processedEmail.findUnique({
    where: { gmailMessageId: BACKFILL_DONE_ID },
    select: { id: true },
  });
  if (alreadyComplete) {
    return {
      done: true,
      sourceMessagesRemaining: 0,
      candidatesFound: 0,
      messagesProcessed: 0,
      filesUploaded: 0,
      shipmentRowsUpdated: 0,
      invoiceRowsUpdated: 0,
      errors: 0,
      errorMessages: [],
    };
  }

  const batchLimit = Math.max(1, Math.min(limit, 5));
  const search = await findCandidates(batchLimit);
  const summary: GmailR2BackfillSummary = {
    done: false,
    sourceMessagesRemaining: search.sourceMessagesRemaining,
    candidatesFound: search.candidates.length,
    messagesProcessed: 0,
    filesUploaded: 0,
    shipmentRowsUpdated: 0,
    invoiceRowsUpdated: 0,
    errors: 0,
    errorMessages: [],
  };

  for (const candidate of search.candidates) {
    try {
      const response = await gmail.users.messages.get({
        userId: "me",
        id: candidate.gmailMessageId,
        format: "full",
      });
      const parts = collectAttachmentParts(response.data.payload);
      const wantedNames = new Set(
        [...candidate.references.values()].map((reference) => reference.name.toLowerCase())
      );
      const wantedExtensions = new Set(
        [...candidate.references.values()].map((reference) => extension(reference.name)).filter(Boolean)
      );
      let selected = parts.filter(
        (part) =>
          wantedNames.has(part.filename.toLowerCase()) ||
          wantedExtensions.has(extension(part.filename))
      );
      // Legacy rows occasionally lost the original display name. In that case, recovering all
      // attachments from this one known source email is safer than leaving the referenced file dead.
      if (selected.length === 0) selected = parts;

      const saved: SavedAttachment[] = [];
      for (const part of selected) {
        const buffer = await loadAttachment(gmail, candidate.gmailMessageId, part);
        if (buffer.length === 0) continue;
        saved.push(await saveUploadedFile(part.filename, buffer));
      }
      if (saved.length === 0) {
        throw new Error("Email nguồn không còn tệp đính kèm có thể phục hồi.");
      }

      const missingUrls = new Set(candidate.references.keys());
      for (const shipmentId of candidate.shipmentIds) {
        if (
          await updateShipmentReferences({
            shipmentId,
            gmailMessageId: candidate.gmailMessageId,
            gmailThreadId: response.data.threadId,
            missingUrls,
            saved,
          })
        ) {
          summary.shipmentRowsUpdated++;
        }
      }
      for (const invoiceId of candidate.invoiceIds) {
        if (await updateInvoiceReferences({ invoiceId, missingUrls, saved })) {
          summary.invoiceRowsUpdated++;
        }
      }

      if (await stillReferencesMissingUrls(candidate)) {
        throw new Error("Không tìm thấy tệp Gmail tương ứng với một hoặc nhiều liên kết cũ.");
      }

      await markBackfilled(
        candidate.gmailMessageId,
        `Đã lưu ${saved.length} tệp vào R2 và cập nhật liên kết trong cơ sở dữ liệu.`
      );

      summary.messagesProcessed++;
      summary.filesUploaded += saved.length;
      summary.sourceMessagesRemaining--;
    } catch (error) {
      summary.errors++;
      const message = error instanceof Error ? error.message : "Lỗi không xác định.";
      summary.errorMessages.push(`${candidate.gmailMessageId}: ${message}`);
      console.error(`Gmail R2 backfill failed for ${candidate.gmailMessageId}:`, error);
    }
  }

  if (summary.sourceMessagesRemaining === 0 && summary.errors === 0) {
    await markBackfillComplete();
    summary.done = true;
  }

  return summary;
}
