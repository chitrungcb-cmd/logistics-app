"use client";

export type ShipmentVehicleDraft = {
  chassisNo: string;
  engineNo: string;
};

export default function ShipmentVehiclesEditor({
  vehicles,
  onChange,
}: {
  vehicles: ShipmentVehicleDraft[];
  onChange: (vehicles: ShipmentVehicleDraft[]) => void;
}) {
  function updateVehicle(
    index: number,
    field: keyof ShipmentVehicleDraft,
    value: string
  ) {
    onChange(
      vehicles.map((vehicle, vehicleIndex) =>
        vehicleIndex === index ? { ...vehicle, [field]: value } : vehicle
      )
    );
  }

  return (
    <section className="mt-5 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Danh sách số khung · số máy</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Dùng để tra cứu nhanh xe đang thuộc lô hàng nào.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...vehicles, { chassisNo: "", engineNo: "" }])}
          className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
        >
          + Thêm xe
        </button>
      </div>

      {vehicles.length === 0 ? (
        <button
          type="button"
          onClick={() => onChange([{ chassisNo: "", engineNo: "" }])}
          className="mt-4 w-full rounded-md border border-dashed border-blue-300 px-4 py-4 text-sm text-blue-700 hover:bg-blue-50"
        >
          Chưa nhập số khung, số máy — bấm để thêm
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          {vehicles.map((vehicle, index) => (
            <div
              key={index}
              className="grid grid-cols-1 items-end gap-3 rounded-md border border-gray-200 bg-white p-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <span className="pb-2 text-center text-sm font-semibold text-gray-400">
                {index + 1}
              </span>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Số khung</span>
                <input
                  value={vehicle.chassisNo}
                  onChange={(event) => updateVehicle(index, "chassisNo", event.target.value)}
                  className="input font-mono uppercase"
                  placeholder="Nhập số khung"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Số máy</span>
                <input
                  value={vehicle.engineNo}
                  onChange={(event) => updateVehicle(index, "engineNo", event.target.value)}
                  className="input font-mono uppercase"
                  placeholder="Nhập số máy"
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                onClick={() => onChange(vehicles.filter((_, vehicleIndex) => vehicleIndex !== index))}
                className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                aria-label={`Xóa xe số ${index + 1}`}
              >
                Xóa
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
