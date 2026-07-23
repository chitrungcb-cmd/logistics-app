import type { gmail_v1 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { saveUploadedFile } from "@/lib/save-upload";
import { parseVendorInvoiceXml } from "@/lib/vendor-invoice-parser";
import { reconcileParsedVendorInvoice, reconcileStoredVendorInvoices } from "@/lib/vendor-invoice-reconciliation";

const NEW_INVOICES_PER_SYNC = 100;

type AttachmentPart = {
  filename: string;
  mimeType: string;
  attachmentId: string | null;
  inlineData: string | null;
};

function collectAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined): AttachmentPart[] {
  if (!part) return [];
  const found: AttachmentPart[] = [];
  if (part.filename && (part.body?.attachmentId || part.body?.data)) {
    found.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      attachmentId: part.body?.attachmentId ?? null,
      inlineData: part.body?.data ?? null,
    });
  }
  for (const child of part.parts ?? []) found.push(...collectAttachmentParts(child));
  return found;
}

function getHeader(message: gmail_v1.Schema$Message, name: string) {
  return message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function isXml(part: AttachmentPart) {
  return part.filename.toLowerCase().endsWith(".xml") || /xml/i.test(part.mimeType);
}

function isPdf(part: AttachmentPart) {
  return part.filename.toLowerCase().endsWith(".pdf") || part.mimeType === "application/pdf";
}

function looksLikeInvoiceEmail(subject: string | null, filename: string) {
  return /h[oó]a\s*đ[oơ]n|hoa\s*don|invoice|e[-\s]?invoice/i.test(`${subject || ""} ${filename}`);
}

async function loadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  part: AttachmentPart
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

export type VendorInvoiceSyncSummary = {
  scanned: number;
  created: number;
  matched: number;
  unmatched: number;
  needsReview: number;
  skipped: number;
  errors: number;
};

/**
 * Reads Vietnamese e-invoice XML attachments from Gmail. PDF-only invoice emails are retained for
 * manual review; XML is the authoritative source for seller/buyer/tax/amount information.
 */
export async function syncVendorInvoices(gmail: gmail_v1.Gmail): Promise<VendorInvoiceSyncSummary> {
  const summary: VendorInvoiceSyncSummary = {
    scanned: 0,
    created: 0,
    matched: 0,
    unmatched: 0,
    needsReview: 0,
    skipped: 0,
    errors: 0,
  };

  let pageToken: string | undefined;
  do {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: "has:attachment (filename:xml OR filename:pdf)",
      maxResults: 100,
      pageToken,
    });
    const messageIds = (list.data.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id));
    summary.scanned += messageIds.length;

    for (const messageId of messageIds) {
      if (summary.created >= NEW_INVOICES_PER_SYNC) break;
      try {
        const response = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
        const message = response.data;
        const subject = getHeader(message, "subject");
        const emailFrom = getHeader(message, "from");
        const parts = collectAttachmentParts(message.payload);
        const xmlParts = parts.filter(isXml);
        const pdfParts = parts.filter(isPdf);
        let savedPdf: { name: string; url: string } | null = null;

        for (const xmlPart of xmlParts) {
          if (summary.created >= NEW_INVOICES_PER_SYNC) break;

          const xmlBuffer = await loadAttachment(gmail, messageId, xmlPart);
          const parsed = parseVendorInvoiceXml(xmlBuffer);
          if (!parsed) {
            summary.skipped++;
            continue;
          }

          // Chống trùng theo DANH TÍNH hóa đơn (MST người bán + ký hiệu + số HĐ), KHÔNG theo
          // attachmentId của Gmail — ID này đổi mỗi lần gọi API nên khóa cũ (messageId:attachmentId)
          // khiến mỗi lần sync tạo lại toàn bộ hóa đơn (đã gây ra hàng nghìn bản trùng).
          const key = parsed.invoiceNumber
            ? `INV:${parsed.sellerTaxCode || "?"}:${parsed.invoiceSymbol || "?"}:${parsed.invoiceNumber}`
            : `MSGXML:${messageId}:${xmlPart.filename}`;
          const exists = parsed.invoiceNumber
            ? await prisma.vendorInvoice.findFirst({
                where: {
                  invoiceNumber: parsed.invoiceNumber,
                  invoiceSymbol: parsed.invoiceSymbol,
                  sellerTaxCode: parsed.sellerTaxCode,
                },
                select: { id: true },
              })
            : await prisma.vendorInvoice.findUnique({ where: { sourceKey: key }, select: { id: true } });
          if (exists) {
            summary.skipped++;
            continue;
          }

          const savedXml = await saveUploadedFile(xmlPart.filename, xmlBuffer);
          if (!savedPdf && pdfParts[0]) {
            const pdfBuffer = await loadAttachment(gmail, messageId, pdfParts[0]);
            savedPdf = await saveUploadedFile(pdfParts[0].filename, pdfBuffer);
          }
          const reconciliation = await reconcileParsedVendorInvoice(parsed);
          const note =
            parsed.invoiceDirection === "OUTPUT"
              ? "Hóa đơn đầu ra do NQ Logistics xuất cho khách hàng."
              : parsed.invoiceDirection === "UNRELATED"
                ? "NQ Logistics không phải bên bán hoặc bên mua; cần kiểm tra hóa đơn."
                : parsed.invoiceDirection === "UNKNOWN"
                  ? "Chưa xác định được hóa đơn đầu vào hay đầu ra; cần kiểm tra MST bên bán và bên mua."
                  : null;

          await prisma.vendorInvoice.create({
            data: {
              sourceKey: key,
              gmailMessageId: messageId,
              gmailThreadId: message.threadId,
              emailSubject: subject,
              emailFrom,
              vendorId: reconciliation.vendorId,
              shipmentCostId: reconciliation.shipmentCostId,
              shipmentId: reconciliation.shipmentId,
              sellerName: parsed.sellerName,
              sellerTaxCode: parsed.sellerTaxCode,
              buyerName: parsed.buyerName,
              buyerTaxCode: parsed.buyerTaxCode,
              isIssuedToNq: parsed.isIssuedToNq,
              invoiceNumber: parsed.invoiceNumber,
              invoiceSymbol: parsed.invoiceSymbol,
              invoiceDate: parsed.invoiceDate,
              subtotal: parsed.subtotal,
              taxAmount: parsed.taxAmount,
              totalAmount: parsed.totalAmount,
              currency: parsed.currency,
              attachmentName: savedPdf?.name || savedXml.name,
              attachmentUrl: savedPdf?.url || savedXml.url,
              xmlUrl: savedXml.url,
              pdfUrl: savedPdf?.url,
              status: reconciliation.status,
              note,
            },
          });
          summary.created++;
          if (reconciliation.status === "MATCHED") summary.matched++;
          else if (reconciliation.status === "UNMATCHED") summary.unmatched++;
          else summary.needsReview++;
        }

        // A PDF without machine-readable XML cannot be safely OCR'd into accounting data here.
        // Keep it in the reconciliation inbox so accounting can inspect it instead of losing it.
        if (xmlParts.length === 0) {
          for (const pdfPart of pdfParts) {
            if (summary.created >= NEW_INVOICES_PER_SYNC) break;
            if (!looksLikeInvoiceEmail(subject, pdfPart.filename)) continue;
            // messageId + tên file (đều ổn định) — không dùng attachmentId dễ đổi.
            const key = `MSGPDF:${messageId}:${pdfPart.filename}`;
            const exists = await prisma.vendorInvoice.findUnique({ where: { sourceKey: key }, select: { id: true } });
            if (exists) {
              summary.skipped++;
              continue;
            }
            const pdfBuffer = await loadAttachment(gmail, messageId, pdfPart);
            const saved = await saveUploadedFile(pdfPart.filename, pdfBuffer);
            await prisma.vendorInvoice.create({
              data: {
                sourceKey: key,
                gmailMessageId: messageId,
                gmailThreadId: message.threadId,
                emailSubject: subject,
                emailFrom,
                attachmentName: saved.name,
                attachmentUrl: saved.url,
                pdfUrl: saved.url,
                status: "NEEDS_REVIEW",
                note: "Email chỉ có PDF; kế toán cần mở file để kiểm tra và nhập thông tin đối chiếu.",
              },
            });
            summary.created++;
            summary.needsReview++;
          }
        }
      } catch (error) {
        summary.errors++;
        console.error(`Invoice sync failed for Gmail message ${messageId}:`, error);
      }
    }

    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken && summary.created < NEW_INVOICES_PER_SYNC);

  // A cost row may receive its invoice number/vendor after the email was first imported. Re-run
  // matching on every automatic Gmail pass so accounting never needs a separate sync button.
  await reconcileStoredVendorInvoices();

  return summary;
}
