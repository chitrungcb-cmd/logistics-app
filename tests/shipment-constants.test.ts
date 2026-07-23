import { describe, expect, it } from "vitest";
import {
  getDeclarationBranches,
  mergeDeclarationBranch,
  normalizeDeclarationBranches,
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
