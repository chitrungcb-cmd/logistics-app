export type ShipmentVehicleInput = {
  chassisNo: string | null;
  engineNo: string | null;
};

const MAX_VEHICLES_PER_SHIPMENT = 500;
const MAX_IDENTIFIER_LENGTH = 100;

function normalizeIdentifier(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} không hợp lệ.`);

  const normalized = value.trim().replace(/\s+/g, "").toUpperCase();
  if (!normalized) return null;
  if (normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${label} không được vượt quá ${MAX_IDENTIFIER_LENGTH} ký tự.`);
  }
  return normalized;
}

export function normalizeShipmentVehicles(value: unknown): ShipmentVehicleInput[] {
  if (!Array.isArray(value)) throw new Error("Danh sách số khung, số máy không hợp lệ.");
  if (value.length > MAX_VEHICLES_PER_SHIPMENT) {
    throw new Error(`Mỗi lô chỉ được nhập tối đa ${MAX_VEHICLES_PER_SHIPMENT} xe.`);
  }

  const vehicles: ShipmentVehicleInput[] = [];
  const chassisNumbers = new Set<string>();
  const engineNumbers = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Thông tin số khung, số máy không hợp lệ.");
    }
    const record = item as Record<string, unknown>;
    const chassisNo = normalizeIdentifier(record.chassisNo, "Số khung");
    const engineNo = normalizeIdentifier(record.engineNo, "Số máy");
    if (!chassisNo && !engineNo) continue;

    if (chassisNo && chassisNumbers.has(chassisNo)) {
      throw new Error(`Số khung ${chassisNo} đang bị nhập trùng trong lô.`);
    }
    if (engineNo && engineNumbers.has(engineNo)) {
      throw new Error(`Số máy ${engineNo} đang bị nhập trùng trong lô.`);
    }
    if (chassisNo) chassisNumbers.add(chassisNo);
    if (engineNo) engineNumbers.add(engineNo);
    vehicles.push({ chassisNo, engineNo });
  }

  return vehicles;
}
