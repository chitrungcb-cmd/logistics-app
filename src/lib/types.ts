import type { Attachment } from "./shipment-constants";

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
  totalAmount: number;
  attachments: Attachment[] | null;
  note: string | null;
  consultationDate: string | null;
  declarationBranches: string[] | null;
  createdAt: string;
  updatedAt: string;
};
