import type { Attachment } from "./shipment-constants";

export type ShipmentVehicleDTO = {
  id: string;
  chassisNo: string | null;
  engineNo: string | null;
};

export type ShipmentDTO = {
  id: string;
  shipmentCode: string;
  customerName: string;
  customerId: string | null;
  taxCode: string | null;
  declarationNo: string | null;
  declarationDate: string | null;
  invoiceNo: string | null;
  customsType: string | null;
  port: string | null;
  goodsName: string | null;
  channel: string | null;
  status: string;
  customsOffice: string | null;
  transport: string | null;
  transportRoute: string | null;
  vehiclePlate: string | null;
  totalAmount: number;
  attachments: Attachment[] | null;
  note: string | null;
  consultationDate: string | null;
  declarationBranches: string[] | null;
  vehicles: ShipmentVehicleDTO[];
  createdAt: string;
  updatedAt: string;
};
