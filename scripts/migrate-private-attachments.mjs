import "dotenv/config";
import { readFile, stat } from "fs/promises";
import path from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { prisma } = await jiti.import("../src/lib/prisma.ts");
const { isPrivateStorageConfigured } = await jiti.import("../src/lib/private-storage.ts");
const { saveUploadedFile } = await jiti.import("../src/lib/save-upload.ts");

const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify") || !apply;

function isLegacyUrl(value) {
  return typeof value === "string" && value.startsWith("/uploads/") && !value.includes("..");
}

function localPath(oldUrl) {
  return path.resolve(process.cwd(), "public", oldUrl.slice(1));
}

async function loadReferences() {
  const [shipments, costs, quotes, invoices, payments, tasks, messageAttachments, otherExpenses] =
    await Promise.all([
      prisma.shipment.findMany({ select: { id: true, attachments: true } }),
      prisma.shipmentCost.findMany({
        where: { attachmentUrl: { startsWith: "/uploads/" } },
        select: { attachmentUrl: true },
      }),
      prisma.quote.findMany({
        where: { attachmentUrl: { startsWith: "/uploads/" } },
        select: { attachmentUrl: true },
      }),
      prisma.vendorInvoice.findMany({
        where: {
          OR: [
            { attachmentUrl: { startsWith: "/uploads/" } },
            { xmlUrl: { startsWith: "/uploads/" } },
            { pdfUrl: { startsWith: "/uploads/" } },
          ],
        },
        select: { attachmentUrl: true, xmlUrl: true, pdfUrl: true },
      }),
      prisma.payment.findMany({
        where: { attachmentUrl: { startsWith: "/uploads/" } },
        select: { attachmentUrl: true },
      }),
      prisma.task.findMany({
        where: { attachmentUrl: { startsWith: "/uploads/" } },
        select: { attachmentUrl: true },
      }),
      prisma.messageAttachment.findMany({
        where: { fileUrl: { startsWith: "/uploads/" } },
        select: { fileUrl: true },
      }),
      prisma.otherExpense.findMany({
        where: { attachmentUrl: { startsWith: "/uploads/" } },
        select: { attachmentUrl: true },
      }),
    ]);

  const urls = new Set();
  for (const shipment of shipments) {
    if (!Array.isArray(shipment.attachments)) continue;
    for (const attachment of shipment.attachments) {
      if (attachment && typeof attachment === "object" && isLegacyUrl(attachment.url)) {
        urls.add(attachment.url);
      }
    }
  }
  for (const row of [...costs, ...quotes, ...payments, ...tasks, ...otherExpenses]) {
    if (isLegacyUrl(row.attachmentUrl)) urls.add(row.attachmentUrl);
  }
  for (const invoice of invoices) {
    for (const value of [invoice.attachmentUrl, invoice.xmlUrl, invoice.pdfUrl]) {
      if (isLegacyUrl(value)) urls.add(value);
    }
  }
  for (const attachment of messageAttachments) {
    if (isLegacyUrl(attachment.fileUrl)) urls.add(attachment.fileUrl);
  }

  return { shipments, urls };
}

async function missingLocalFiles(urls) {
  const missing = [];
  for (const url of urls) {
    try {
      const fileStat = await stat(localPath(url));
      if (!fileStat.isFile() || fileStat.size <= 0) missing.push(url);
    } catch {
      missing.push(url);
    }
  }
  return missing;
}

async function replaceUrl(oldUrl, newUrl, shipments) {
  const shipmentUpdates = [];
  for (const shipment of shipments) {
    if (!Array.isArray(shipment.attachments)) continue;
    let changed = false;
    const attachments = shipment.attachments.map((attachment) => {
      if (!attachment || typeof attachment !== "object" || attachment.url !== oldUrl) return attachment;
      changed = true;
      return { ...attachment, url: newUrl };
    });
    if (changed) shipmentUpdates.push({ shipment, attachments });
  }

  await prisma.$transaction(async (tx) => {
    for (const update of shipmentUpdates) {
      await tx.shipment.update({
        where: { id: update.shipment.id },
        data: { attachments: update.attachments },
      });
    }
    // Interactive transactions share one PostgreSQL connection; keep statements sequential to
    // avoid overlapping client.query calls (pg 9 removes that deprecated behavior).
    await tx.shipmentCost.updateMany({ where: { attachmentUrl: oldUrl }, data: { attachmentUrl: newUrl } });
    await tx.quote.updateMany({ where: { attachmentUrl: oldUrl }, data: { attachmentUrl: newUrl } });
    await tx.payment.updateMany({ where: { attachmentUrl: oldUrl }, data: { attachmentUrl: newUrl } });
    await tx.task.updateMany({ where: { attachmentUrl: oldUrl }, data: { attachmentUrl: newUrl } });
    await tx.messageAttachment.updateMany({ where: { fileUrl: oldUrl }, data: { fileUrl: newUrl } });
    await tx.otherExpense.updateMany({ where: { attachmentUrl: oldUrl }, data: { attachmentUrl: newUrl } });
    await tx.vendorInvoice.updateMany({ where: { attachmentUrl: oldUrl }, data: { attachmentUrl: newUrl } });
    await tx.vendorInvoice.updateMany({ where: { xmlUrl: oldUrl }, data: { xmlUrl: newUrl } });
    await tx.vendorInvoice.updateMany({ where: { pdfUrl: oldUrl }, data: { pdfUrl: newUrl } });
  });

  for (const update of shipmentUpdates) update.shipment.attachments = update.attachments;
}

try {
  const initial = await loadReferences();
  console.log(`Tìm thấy ${initial.urls.size} tệp cũ đang được dữ liệu tham chiếu.`);

  const missing = verify ? await missingLocalFiles(initial.urls) : [];
  if (verify) {
    console.log(`Kiểm tra file local: ${initial.urls.size - missing.length}/${initial.urls.size} tệp sẵn sàng.`);
    if (missing.length > 0) {
      console.error(`Thiếu ${missing.length} tệp. Không thể di chuyển an toàn.`);
      process.exitCode = 1;
    }
  }

  if (!apply) {
    console.log("Chạy npm run storage:migrate sau khi đã cấu hình Supabase Storage.");
  } else if (missing.length === 0) {
    if (!isPrivateStorageConfigured()) {
      throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.");
    }

    let migrated = 0;
    for (const oldUrl of initial.urls) {
      const filePath = localPath(oldUrl);
      const storedName = path.basename(filePath);
      const originalName = storedName.replace(/^\d+-[0-9a-f]{32}-/, "") || storedName;
      const saved = await saveUploadedFile(originalName, await readFile(filePath));

      // Update every reference immediately after each successful upload. A stopped migration can
      // therefore be resumed safely; already-updated URLs disappear from the next dry run.
      await replaceUrl(oldUrl, saved.url, initial.shipments);
      migrated += 1;
      if (migrated % 25 === 0 || migrated === initial.urls.size) {
        console.log(`Đã chuyển ${migrated}/${initial.urls.size} tệp sang kho riêng tư.`);
      }
    }

    const remaining = await loadReferences();
    if (remaining.urls.size > 0) {
      throw new Error(`Còn ${remaining.urls.size} tệp cũ chưa được cập nhật.`);
    }
    console.log("Đã chuyển toàn bộ chứng từ được tham chiếu. File local được giữ làm bản khôi phục.");
  }
} finally {
  await prisma.$disconnect();
}
