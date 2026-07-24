import { describe, expect, it } from "vitest";
import {
  getDeclarationBranches,
  isClearanceDecisionFilename,
  mergeDeclarationBranch,
  normalizeDeclarationBranches,
  resolveSyncedShipmentStatus,
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
