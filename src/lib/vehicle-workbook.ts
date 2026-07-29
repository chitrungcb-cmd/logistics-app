import ExcelJS from "exceljs";
import {
  normalizeShipmentVehicles,
  type ShipmentVehicleInput,
} from "@/lib/shipment-vehicles";

const MAX_HEADER_ROWS = 30;
const MAX_HEADER_COLUMNS = 100;
const MAX_VEHICLE_ROWS = 500;

const CHASSIS_HEADERS = new Set([
  "sokhung",
  "khung",
  "chassis",
  "chassisno",
  "vin",
  "vinnumber",
]);

const ENGINE_HEADERS = new Set([
  "sodongco",
  "dongco",
  "somay",
  "may",
  "engine",
  "engineno",
  "enginenumber",
]);

function normalizedHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findVehicleColumns(sheet: ExcelJS.Worksheet) {
  const lastHeaderRow = Math.min(sheet.rowCount, MAX_HEADER_ROWS);
  for (let rowNumber = 1; rowNumber <= lastHeaderRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    let chassisColumn: number | null = null;
    let engineColumn: number | null = null;

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (columnNumber > MAX_HEADER_COLUMNS) return;
      const header = normalizedHeader(cell.text);
      if (!chassisColumn && CHASSIS_HEADERS.has(header)) chassisColumn = columnNumber;
      if (!engineColumn && ENGINE_HEADERS.has(header)) engineColumn = columnNumber;
    });

    if (chassisColumn && engineColumn) {
      return { headerRow: rowNumber, chassisColumn, engineColumn };
    }
  }
  return null;
}

function mergeUniqueVehicles(groups: ShipmentVehicleInput[][]) {
  const vehicles: ShipmentVehicleInput[] = [];
  const chassisNumbers = new Set<string>();
  const engineNumbers = new Set<string>();

  for (const vehicle of groups.flat()) {
    if (vehicle.chassisNo && chassisNumbers.has(vehicle.chassisNo)) continue;
    if (vehicle.engineNo && engineNumbers.has(vehicle.engineNo)) continue;
    if (vehicle.chassisNo) chassisNumbers.add(vehicle.chassisNo);
    if (vehicle.engineNo) engineNumbers.add(vehicle.engineNo);
    vehicles.push(vehicle);
    if (vehicles.length >= MAX_VEHICLE_ROWS) break;
  }
  return vehicles;
}

export type VehicleWorkbookResult = {
  matchedVehicleSheet: boolean;
  vehicles: ShipmentVehicleInput[];
};

/**
 * Reads the vehicle list embedded in an automobile XLSX attachment. The workbook remains the
 * source of truth; ShipmentVehicle rows are only a hidden search index for chassis/engine lookup.
 */
export async function extractVehiclesFromWorkbook(
  buffer: Buffer
): Promise<VehicleWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  let matchedVehicleSheet = false;
  const groups: ShipmentVehicleInput[][] = [];

  for (const sheet of workbook.worksheets) {
    const columns = findVehicleColumns(sheet);
    if (!columns) continue;
    matchedVehicleSheet = true;

    const rawVehicles: Array<{ chassisNo: string; engineNo: string }> = [];
    for (
      let rowNumber = columns.headerRow + 1;
      rowNumber <= sheet.rowCount && rawVehicles.length < MAX_VEHICLE_ROWS;
      rowNumber++
    ) {
      const row = sheet.getRow(rowNumber);
      const chassisNo = row.getCell(columns.chassisColumn).text.trim();
      const engineNo = row.getCell(columns.engineColumn).text.trim();
      if (!chassisNo && !engineNo) continue;
      rawVehicles.push({ chassisNo, engineNo });
    }

    if (rawVehicles.length > 0) {
      groups.push(normalizeShipmentVehicles(rawVehicles));
    }
  }

  return {
    matchedVehicleSheet,
    vehicles: mergeUniqueVehicles(groups),
  };
}
