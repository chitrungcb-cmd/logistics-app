import { describe, expect, it } from "vitest";
import { normalizeCustomsGate, presetGateMatchesPort, getGoodsKeyword, getGoodsQuantity, isPerLotUnit } from "@/lib/goods-keyword";
import { selectApplicablePresets } from "@/lib/cost-presets";
import type { CostCategory } from "@/generated/prisma/enums";

describe("normalizeCustomsGate + presetGateMatchesPort", () => {
  it("normalizes accents, đ, spaces and case", () => {
    expect(normalizeCustomsGate("Trà Lĩnh")).toBe("TRALINH");
    expect(normalizeCustomsGate("cửa khẩu Móng Cái")).toBe("CUAKHAUMONGCAI");
    expect(normalizeCustomsGate(null)).toBe("");
  });

  it("matches a preset gate against the free-text shipment port", () => {
    const port = "CUA KHAU TRA LINH (CAO BANG) (VNTLG)";
    expect(presetGateMatchesPort("Trà Lĩnh", port)).toBe(true);
    expect(presetGateMatchesPort("Mộc Bài", port)).toBe(false);
    // Cửa khẩu rỗng = áp mọi cửa khẩu.
    expect(presetGateMatchesPort("", port)).toBe(true);
    expect(presetGateMatchesPort("Trà Lĩnh", null)).toBe(false);
  });
});

type P = { id: string; category: CostCategory; customsGate: string; effectiveFrom: Date };
const EPOCH = new Date("1970-01-01T00:00:00.000Z");
function p(id: string, category: CostCategory, gate: string, from: Date = EPOCH): P {
  return { id, category, customsGate: gate, effectiveFrom: from };
}
const NOW = new Date("2026-07-28");

describe("selectApplicablePresets — mỗi cửa khẩu × mặt hàng áp đúng, không xung đột", () => {
  const traLinhPort = "CUA KHAU TRA LINH (CAO BANG)";
  const mocBaiPort = "CUA KHAU MOC BAI (TAY NINH)";

  it("prefers the gate-specific preset over the all-gates fallback", () => {
    const presets = [p("all-hq", "HAI_QUAN", ""), p("tl-hq", "HAI_QUAN", "Trà Lĩnh")];
    expect(selectApplicablePresets(presets, traLinhPort, NOW).map((x) => x.id)).toEqual(["tl-hq"]);
  });

  it("falls back to the all-gates preset when no gate-specific one matches", () => {
    const presets = [p("all-hq", "HAI_QUAN", ""), p("tl-hq", "HAI_QUAN", "Trà Lĩnh")];
    expect(selectApplicablePresets(presets, mocBaiPort, NOW).map((x) => x.id)).toEqual(["all-hq"]);
  });

  it("keeps different gates independent (không lấy nhầm giá cửa khẩu khác)", () => {
    const presets = [p("tl-hq", "HAI_QUAN", "Trà Lĩnh"), p("mb-hq", "HAI_QUAN", "Mộc Bài")];
    expect(selectApplicablePresets(presets, traLinhPort, NOW).map((x) => x.id)).toEqual(["tl-hq"]);
    expect(selectApplicablePresets(presets, mocBaiPort, NOW).map((x) => x.id)).toEqual(["mb-hq"]);
    expect(selectApplicablePresets(presets, "CUA KHAU HUU NGHI (LANG SON)", NOW)).toEqual([]);
  });

  it("applies exactly one preset per category across gates", () => {
    const presets = [p("tl-hq", "HAI_QUAN", "Trà Lĩnh"), p("tl-vt", "KHAC", "Trà Lĩnh"), p("tl-hh", "HOA_HONG", "Trà Lĩnh")];
    const chosen = selectApplicablePresets(presets, traLinhPort, NOW);
    expect(chosen).toHaveLength(3);
    expect(new Set(chosen.map((x) => x.category))).toEqual(new Set(["HAI_QUAN", "KHAC", "HOA_HONG"]));
  });
});

describe("selectApplicablePresets — mốc thời gian 'áp dụng từ ngày'", () => {
  const port = "CUA KHAU TRA LINH";
  const jul = new Date("2026-07-01");
  const sep = new Date("2026-09-01");
  const presets = [
    p("v1", "HAI_QUAN", "Trà Lĩnh", jul),
    p("v2", "HAI_QUAN", "Trà Lĩnh", sep),
  ];

  it("picks the latest milestone at or before the declaration date", () => {
    // Lô ngày 15/08 → dùng mốc 1/7 (v1); lô ngày 15/09 → dùng mốc 1/9 (v2).
    expect(selectApplicablePresets(presets, port, new Date("2026-08-15")).map((x) => x.id)).toEqual(["v1"]);
    expect(selectApplicablePresets(presets, port, new Date("2026-09-15")).map((x) => x.id)).toEqual(["v2"]);
  });

  it("ignores milestones that have not started yet", () => {
    // Lô ngày 15/06 → cả hai mốc đều chưa tới → không áp.
    expect(selectApplicablePresets(presets, port, new Date("2026-06-15"))).toEqual([]);
  });

  it("gate-specific wins over all-gates regardless of the newer all-gates milestone", () => {
    const mixed = [
      p("all-new", "HAI_QUAN", "", sep),
      p("tl-old", "HAI_QUAN", "Trà Lĩnh", jul),
    ];
    // Lô 15/09: cả hai đã hiệu lực → bộ cửa khẩu cụ thể thắng dù mốc cũ hơn.
    expect(selectApplicablePresets(mixed, port, new Date("2026-09-15")).map((x) => x.id)).toEqual(["tl-old"]);
  });
});

describe("goods keyword still groups the goods name", () => {
  it("máy nghiền đá cũ → MÁY NGHIỀN", () => {
    expect(getGoodsKeyword("Máy nghiền đá cũ")).toBe("MÁY NGHIỀN");
    expect(getGoodsKeyword("10 MÁY NGHIỀN ĐÁ")).toBe("MÁY NGHIỀN");
  });
});

describe("số lượng theo tên hàng + đơn vị tính", () => {
  it("lấy số đứng đầu tên hàng làm số lượng", () => {
    expect(getGoodsQuantity("10 MÁY NGHIỀN ĐÁ")).toBe(10);
    expect(getGoodsQuantity("20 ĐẦU KÉO")).toBe(20);
    expect(getGoodsQuantity("Máy nghiền đá cũ")).toBe(1); // không có số đầu
    expect(getGoodsQuantity(null)).toBe(1);
  });

  it("đơn vị 'Lô'/để trống = cho cả lô; máy/xe = theo số lượng", () => {
    expect(isPerLotUnit("Lô")).toBe(true);
    expect(isPerLotUnit("lô")).toBe(true);
    expect(isPerLotUnit("")).toBe(true);
    expect(isPerLotUnit(null)).toBe(true);
    expect(isPerLotUnit("máy")).toBe(false);
    expect(isPerLotUnit("xe")).toBe(false);
  });
});
