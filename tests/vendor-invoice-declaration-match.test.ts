import { describe, expect, it } from "vitest";
import { extractDeclarationNumbers } from "@/lib/vendor-invoice-parser";
import {
  matchOutputInvoiceByDeclaration,
  type OutputShipmentCandidate,
} from "@/lib/vendor-invoice-reconciliation";

describe("extractDeclarationNumbers", () => {
  it("picks the declaration number right after 'tờ khai'", () => {
    const text =
      "Phí dịch vụ giao nhận và vận chuyển xe Ô tô trộn, Model:ZZ5257 chưa đăng ký, theo tờ khai nhập " +
      "khẩu số 10845474696 ngày 21/07/2026 - số máy : LZZ1BLSF1TN609249";
    expect(extractDeclarationNumbers(text)).toEqual(["10845474696"]);
  });

  it("does not mistake chassis/model numbers for a declaration", () => {
    // Không có chữ "khai" đứng trước → không lấy các dãy số khung.
    expect(extractDeclarationNumbers("số máy LZZ1BLSF1TN609249 - D10385026060700")).toEqual([]);
  });

  it("collects multiple distinct declarations and dedupes", () => {
    const text = "tờ khai số 10845474696 ... tờ khai nhập khẩu số 10845474696 ... khai 108399733040";
    expect(extractDeclarationNumbers(text).sort()).toEqual(["108399733040", "10845474696"].sort());
  });

  it("returns empty for text without a declaration", () => {
    expect(extractDeclarationNumbers("Phí dịch vụ trọn gói")).toEqual([]);
  });
});

function candidate(id: string, declarationNo: string, branches: string[] | null = null): OutputShipmentCandidate {
  return {
    id,
    shipmentCode: `LH-${id}`,
    declarationNo,
    declarationBranches: branches,
    declarationDate: null,
    goodsName: null,
    customerName: "KH",
    taxCode: null,
    customer: null,
    debts: [],
    quotes: [],
  };
}

describe("matchOutputInvoiceByDeclaration", () => {
  const shipments = [
    candidate("A", "108454746960"), // họ 10845474696
    candidate("B", "107369176020"),
    candidate("C", "108399733040", ["108399733040", "108399733041"]),
  ];

  it("matches the shipment whose declaration family equals the invoice's cited number", () => {
    // HĐ ghi 11 số "10845474696" → khớp lô A (TK 12 số cùng 11 số đầu).
    expect(matchOutputInvoiceByDeclaration({ declarationNumbers: ["10845474696"] }, shipments)?.id).toBe("A");
  });

  it("matches via a declaration branch too", () => {
    expect(matchOutputInvoiceByDeclaration({ declarationNumbers: ["108399733041"] }, shipments)?.id).toBe("C");
  });

  it("returns null when no shipment shares the family", () => {
    expect(matchOutputInvoiceByDeclaration({ declarationNumbers: ["99999999999"] }, shipments)).toBeNull();
  });

  it("returns null when there are no cited declaration numbers", () => {
    expect(matchOutputInvoiceByDeclaration({ declarationNumbers: [] }, shipments)).toBeNull();
  });
});
