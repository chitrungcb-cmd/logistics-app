import "dotenv/config";
import { createJiti } from "jiti";
import { randomUUID } from "node:crypto";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { prisma } = await jiti.import("../src/lib/prisma.ts");
const { syncShipmentDebts } = await jiti.import("../src/lib/shipment-debt-sync.ts");

async function verifySyncWithRollback() {
  const rollbackMarker = `ROLLBACK_SYNC_TEST_${randomUUID()}`;

  try {
    await prisma.$transaction(async (tx) => {
      const suffix = randomUUID();
      const customer = await tx.customer.create({
        data: {
          companyName: "Kiểm thử đồng bộ công nợ",
          taxCode: `SYNC-${suffix}`,
        },
      });
      const shipment = await tx.shipment.create({
        data: {
          shipmentCode: `SYNC-${suffix}`,
          customerName: customer.companyName,
          customerId: customer.id,
        },
      });
      const cost = await tx.shipmentCost.create({
        data: {
          shipmentId: shipment.id,
          category: "VAN_TAI",
          unitPrice: 120_000,
          quantity: 1,
          costPrice: 120_000,
          isActual: true,
        },
      });
      const quote = await tx.quote.create({
        data: { shipmentId: shipment.id, quoteAmount: 300_000 },
      });

      const first = await syncShipmentDebts(tx, shipment.id);
      let debts = await tx.debt.findMany({ where: { shipmentId: shipment.id } });
      if (!first.ready || debts.length !== 2) throw new Error("Không tạo đủ cặp công nợ tự động.");

      await tx.quote.update({ where: { id: quote.id }, data: { quoteAmount: 350_000 } });
      await tx.shipmentCost.update({
        where: { id: cost.id },
        data: { unitPrice: 140_000, costPrice: 140_000 },
      });
      await syncShipmentDebts(tx, shipment.id);
      debts = await tx.debt.findMany({ where: { shipmentId: shipment.id } });
      const receivable = debts.find((debt) => debt.type === "RECEIVABLE");
      const payable = debts.find((debt) => debt.type === "PAYABLE");
      if (debts.length !== 2 || receivable?.totalAmount !== 350_000 || payable?.totalAmount !== 140_000) {
        throw new Error("Công nợ không được cập nhật idempotent theo số tiền nguồn.");
      }

      throw new Error(rollbackMarker);
    });
  } catch (error) {
    if (error instanceof Error && error.message === rollbackMarker) {
      console.log("Kiểm thử đạt: tạo/cập nhật đúng 2 công nợ và toàn bộ dữ liệu thử đã rollback.");
      return;
    }
    throw error;
  }
}

try {
  if (process.argv.includes("--verify")) {
    await verifySyncWithRollback();
    process.exitCode = 0;
  } else {
    const limitOption = process.argv.find((argument) => argument.startsWith("--limit="));
    const parsedLimit = limitOption ? Number(limitOption.slice("--limit=".length)) : undefined;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
    const shipments = await prisma.shipment.findMany({
      where: {
        OR: [
          {
            costs: { some: { costPrice: { gt: 0 } } },
            quotes: { some: { quoteAmount: { gt: 0 } } },
          },
          { debts: { some: { sourceKey: { not: null } } } },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      ...(limit ? { take: limit } : {}),
    });

    let ready = 0;
    for (const shipment of shipments) {
      const result = await prisma.$transaction((tx) => syncShipmentDebts(tx, shipment.id));
      if (result.ready) ready += 1;
    }

    console.log(`Đã kiểm tra ${shipments.length} lô hàng; ${ready} lô đủ dữ liệu để đồng bộ công nợ.`);
  }
} finally {
  await prisma.$disconnect();
}
