import { describe, expect, it } from "vitest";
import {
  attachmentBelongsToDeclarationFamilies,
  attachmentMatchesDeclaration,
  declarationNumbersFromFilename,
  getDeclarationBranches,
  isClearanceDecisionFilename,
  mergeUniqueAttachments,
  mergeDeclarationBranch,
  normalizeDeclarationBranches,
  resolveSyncedShipmentStatus,
  sharesDeclarationFamily,
} from "@/lib/shipment-constants";

describe("declaration branches", () => {
  it("hides legacy amendment numbers that belong to one declaration family", () => {
    const legacyBranches = ["108028471610", "108028471612"];

    expect(normalizeDeclarationBranches(legacyBranches)).toEqual(["108028471612"]);
    expect(getDeclarationBranches(legacyBranches)).toBeNull();
  });

  it("continues to display genuinely different declaration families as branches", () => {
    expect(getDeclarationBranches(["108028471610", "107982104751"])).toEqual([
      { label: "Nhánh 1", number: "108028471610" },
      { label: "Nhánh 2", number: "107982104751" },
    ]);
  });

  it("cleans legacy duplicates the next time Gmail sync updates a declaration", () => {
    expect(mergeDeclarationBranch(["108028471610", "108028471612"], "108028471610")).toEqual([
      "108028471610",
    ]);
  });
});

describe("invoice-match guard (sharesDeclarationFamily)", () => {
  it("accepts an amendment of an existing declaration (same 11-digit family)", () => {
    // Bản sửa 108028471612 của tờ khai 108028471610 đã có trên lô — cùng prefix → cùng lô.
    expect(
      sharesDeclarationFamily(
        { declarationNo: "108028471610", declarationBranches: null },
        "108028471612"
      )
    ).toBe(true);
    // Cùng họ với một nhánh (không phải declarationNo chính) cũng được chấp nhận.
    expect(
      sharesDeclarationFamily(
        { declarationNo: "107369176020", declarationBranches: ["107369176020", "108399733040"] },
        "108399733041"
      )
    ).toBe(true);
  });

  it("rejects a genuinely separate declaration that only shares the commercial invoice", () => {
    // Bug thực tế: 3 tờ khai khác prefix, chung invoice 855SWKH-2005C-1 — KHÔNG được coi là cùng lô.
    expect(
      sharesDeclarationFamily(
        { declarationNo: "107369176020", declarationBranches: ["107369176020"] },
        "107174763950"
      )
    ).toBe(false);
    expect(
      sharesDeclarationFamily(
        { declarationNo: "107369176020", declarationBranches: ["107369176020", "107174763950"] },
        "108399733040"
      )
    ).toBe(false);
  });
});

describe("Gmail shipment status sync", () => {
  it("recognizes the actual VNACCS clearance-decision filename", () => {
    expect(isClearanceDecisionFilename("ToKhaiHQ7N_QDTQ_108346275001.xlsx")).toBe(true);
    expect(isClearanceDecisionFilename("ToKhaiHQ7N_108346275001.xlsx")).toBe(false);
  });

  it("moves a stored shipment to cleared when a clearance decision arrives", () => {
    expect(
      resolveSyncedShipmentStatus("Đưa hàng về bảo quản", {
        isCleared: true,
        hasStorageInstruction: true,
      })
    ).toBe("Thông quan");
  });

  it("does not let an older storage email downgrade a cleared shipment", () => {
    expect(
      resolveSyncedShipmentStatus("Thông quan", {
        isCleared: false,
        hasStorageInstruction: true,
      })
    ).toBe("Thông quan");
  });
});

describe("attachment deduplication", () => {
  it("keeps one row when content-addressed URLs differ only by display name", () => {
    const uploadedAt = "2026-07-24T00:00:00.000Z";
    expect(
      mergeUniqueAttachments(
        [{ name: "a.pdf", url: "/api/attachments/file/attachments/sha256/ab/hash.pdf?name=a.pdf", uploadedAt }],
        [{ name: "renamed.pdf", url: "/api/attachments/file/attachments/sha256/ab/hash.pdf?name=renamed.pdf", uploadedAt }]
      )
    ).toHaveLength(1);
  });
});

describe("Gmail attachment assignment", () => {
  it("extracts the declaration number from real VNACCS filenames", () => {
    expect(declarationNumbersFromFilename("ToKhaiHQ7N_107168431751.xlsx")).toEqual([
      "107168431751",
    ]);
    expect(
      declarationNumbersFromFilename("ToKhaiHQ7N_QDTQ_107168431751_signed.xlsx")
    ).toEqual(["107168431751"]);
  });

  it("keeps each parsed workbook with its own declaration in a multi-declaration email", () => {
    expect(
      attachmentMatchesDeclaration({
        filename: "ToKhaiHQ7N_107168431753.xlsx",
        parsedDeclarationNo: "107168431753",
        targetDeclarationNo: "107168431751",
        declarationCount: 4,
      })
    ).toBe(false);
    expect(
      attachmentMatchesDeclaration({
        filename: "ToKhaiHQ7N_107168431751.xlsx",
        parsedDeclarationNo: "107168431751",
        targetDeclarationNo: "107168431751",
        declarationCount: 4,
      })
    ).toBe(true);
  });

  it("does not guess where an unnumbered file belongs when an email has several declarations", () => {
    expect(
      attachmentMatchesDeclaration({
        filename: "chung-tu-khac.pdf",
        targetDeclarationNo: "107168431751",
        declarationCount: 4,
      })
    ).toBe(false);
    expect(
      attachmentMatchesDeclaration({
        filename: "chung-tu-khac.pdf",
        targetDeclarationNo: "107168431751",
        declarationCount: 1,
      })
    ).toBe(true);
  });

  it("removes files from unrelated declaration families during legacy repair", () => {
    const shipmentNumbers = ["107168431751"];
    expect(
      attachmentBelongsToDeclarationFamilies(
        "ToKhaiHQ7N_107168497001.xlsx",
        shipmentNumbers
      )
    ).toBe(false);
    // A later revision of the same declaration family remains part of the same shipment.
    expect(
      attachmentBelongsToDeclarationFamilies(
        "ToKhaiHQ7N_107168431753.xlsx",
        shipmentNumbers
      )
    ).toBe(true);
  });
});
