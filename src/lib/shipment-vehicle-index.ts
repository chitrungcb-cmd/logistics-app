import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/private-storage";
import {
  shipmentRequiresHys,
  type Attachment,
} from "@/lib/shipment-constants";
import {
  extractVehiclesFromWorkbook,
  type VehicleWorkbookResult,
} from "@/lib/vehicle-workbook";
import type { ShipmentVehicleInput } from "@/lib/shipment-vehicles";

const MAX_VEHICLE_WORKBOOK_BYTES = 20 * 1024 * 1024;

function workbookAttachments(attachments: Attachment[]) {
  return attachments.filter((attachment) =>
    attachment.name.toLowerCase().endsWith(".xlsx")
  );
}

function mergeVehicles(groups: ShipmentVehicleInput[][]) {
  const vehicles: ShipmentVehicleInput[] = [];
  const chassisNumbers = new Set<string>();
  const engineNumbers = new Set<string>();

  for (const vehicle of groups.flat()) {
    if (vehicle.chassisNo && chassisNumbers.has(vehicle.chassisNo)) continue;
    if (vehicle.engineNo && engineNumbers.has(vehicle.engineNo)) continue;
    if (vehicle.chassisNo) chassisNumbers.add(vehicle.chassisNo);
    if (vehicle.engineNo) engineNumbers.add(vehicle.engineNo);
    vehicles.push(vehicle);
  }
  return vehicles;
}

export async function indexShipmentVehiclesFromAttachments(input: {
  shipmentId: string;
  attachments: Attachment[];
}) {
  const parsedWorkbooks: VehicleWorkbookResult[] = [];

  for (const attachment of workbookAttachments(input.attachments)) {
    try {
      const buffer = await readStoredFile(
        attachment.url,
        MAX_VEHICLE_WORKBOOK_BYTES
      );
      const result = await extractVehiclesFromWorkbook(buffer);
      if (result.matchedVehicleSheet) parsedWorkbooks.push(result);
    } catch (error) {
      console.error(
        `Vehicle workbook indexing skipped ${attachment.name}:`,
        error
      );
    }
  }

  if (parsedWorkbooks.length === 0) {
    return { matchedVehicleWorkbook: false, indexedVehicles: 0 };
  }

  const vehicles = mergeVehicles(
    parsedWorkbooks.map((workbook) => workbook.vehicles)
  );
  await prisma.$transaction(async (transaction) => {
    await transaction.shipmentVehicle.deleteMany({
      where: { shipmentId: input.shipmentId },
    });
    if (vehicles.length > 0) {
      await transaction.shipmentVehicle.createMany({
        data: vehicles.map((vehicle) => ({
          ...vehicle,
          shipmentId: input.shipmentId,
        })),
        skipDuplicates: true,
      });
    }
  });

  return {
    matchedVehicleWorkbook: true,
    indexedVehicles: vehicles.length,
  };
}

/**
 * Backfills recent automobile shipments created before workbook indexing existed. It is only used
 * during chassis/engine searches and scheduled Gmail syncs; normal shipment listing stays fast.
 */
export async function backfillShipmentVehicleIndex(limit = 20) {
  const candidates = await prisma.shipment.findMany({
    where: { vehicles: { none: {} } },
    orderBy: [
      { declarationDate: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: Math.max(limit * 3, limit),
    select: {
      id: true,
      goodsName: true,
      attachments: true,
    },
  });

  let indexedWorkbooks = 0;
  for (const shipment of candidates) {
    if (indexedWorkbooks >= limit) break;
    if (!shipmentRequiresHys(shipment.goodsName)) continue;
    const attachments = Array.isArray(shipment.attachments)
      ? (shipment.attachments as unknown as Attachment[])
      : [];
    if (workbookAttachments(attachments).length === 0) continue;

    const result = await indexShipmentVehiclesFromAttachments({
      shipmentId: shipment.id,
      attachments,
    });
    if (result.matchedVehicleWorkbook) indexedWorkbooks++;
  }

  return indexedWorkbooks;
}
