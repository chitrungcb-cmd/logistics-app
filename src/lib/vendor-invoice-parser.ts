export type ParsedVendorInvoice = {
  sellerName: string | null;
  sellerTaxCode: string | null;
  buyerName: string | null;
  buyerTaxCode: string | null;
  invoiceNumber: string | null;
  invoiceSymbol: string | null;
  invoiceDate: Date | null;
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string;
  invoiceDirection: InvoiceDirection;
  isIssuedToNq: boolean | null;
  // Số tờ khai hải quan trích từ mô tả dòng hàng (HĐ bán ra xe ô tô ghi "theo tờ khai nhập khẩu
  // số ..."). Dùng để khớp đúng lô hàng; rỗng nếu nội dung không nhắc tới tờ khai.
  declarationNumbers: string[];
};

/**
 * Trích số tờ khai (10–13 chữ số) ngay sau chữ "khai" trong nội dung hóa đơn — ví dụ
 * "theo tờ khai nhập khẩu số 10845474696". Bỏ qua các dãy số khác (số khung, model) vì chúng không
 * đứng sau chữ "khai".
 */
export function extractDeclarationNumbers(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(/khai[^\d]{0,40}?(\d{10,13})/gi)) {
    found.add(match[1]);
  }
  return [...found];
}

export type InvoiceDirection = "INPUT" | "OUTPUT" | "UNRELATED" | "UNKNOWN";

const DEFAULT_NQ_TAX_CODE = "4900917685";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(value: string) {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanXmlValue(value: string | undefined) {
  if (!value) return null;
  const cleaned = decodeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  return cleaned || null;
}

function findTag(xml: string, names: string[]) {
  for (const name of names) {
    const tag = escapeRegExp(name);
    const match = xml.match(
      new RegExp(`<(?:(?:[\\w.-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${tag}\\s*>`, "i")
    );
    const value = cleanXmlValue(match?.[1]);
    if (value) return value;
  }
  return null;
}

function findSection(xml: string, names: string[]) {
  for (const name of names) {
    const tag = escapeRegExp(name);
    const match = xml.match(
      new RegExp(`<(?:(?:[\\w.-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${tag}\\s*>`, "i")
    );
    if (match?.[1]) return match[1];
  }
  return "";
}

function decodeXml(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return new TextDecoder("utf-16le").decode(swapped);
  }
  const utf8 = buffer.toString("utf8");
  if (/encoding=["']utf-16/i.test(utf8.slice(0, 200)) || utf8.includes("\u0000")) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  return utf8;
}

function parseAmount(value: string | null) {
  if (!value) return null;
  const compact = value.replace(/[^0-9,.-]/g, "");
  if (!compact) return null;

  let normalized = compact;
  const commaCount = (compact.match(/,/g) ?? []).length;
  const dotCount = (compact.match(/\./g) ?? []).length;
  if (commaCount > 0 && dotCount > 0) {
    const decimalSeparator = compact.lastIndexOf(",") > compact.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = compact.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (commaCount > 1 || dotCount > 1) {
    normalized = compact.replace(/[,.]/g, "");
  } else if (commaCount === 1) {
    normalized = compact.replace(",", ".");
  } else if (dotCount === 1) {
    // XML invoices store machine-readable decimals (for example 183000.000). A single dot is
    // therefore a decimal separator, not a Vietnamese thousands separator. Multiple dots/commas
    // are handled as display-formatted thousands separators by the branch above.
    normalized = compact;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseInvoiceDate(value: string | null) {
  if (!value) return null;
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const viMatch = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  const date = isoMatch
    ? new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}T00:00:00`)
    : viMatch
      ? new Date(`${viMatch[3]}-${viMatch[2].padStart(2, "0")}-${viMatch[1].padStart(2, "0")}T00:00:00`)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCompanyName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .toUpperCase();
}

function determinePartyIsNq(name: string | null, taxCode: string | null) {
  const expectedTaxCode = (
    process.env.NQ_TAX_CODE || process.env.NQ_COMPANY_TAX_CODE || DEFAULT_NQ_TAX_CODE
  ).replace(/\D/g, "");
  const normalizedTaxCode = (taxCode || "").replace(/\D/g, "");
  if (expectedTaxCode && normalizedTaxCode) return expectedTaxCode === normalizedTaxCode;
  if (name) return /(^|[^A-Z0-9])NQ([^A-Z0-9]|$)/.test(normalizeCompanyName(name));
  return null;
}

export function determineInvoiceDirection(
  sellerName: string | null,
  sellerTaxCode: string | null,
  buyerName: string | null,
  buyerTaxCode: string | null
): InvoiceDirection {
  const sellerIsNq = determinePartyIsNq(sellerName, sellerTaxCode);
  const buyerIsNq = determinePartyIsNq(buyerName, buyerTaxCode);

  if (sellerIsNq === true && buyerIsNq !== true) return "OUTPUT";
  if (buyerIsNq === true && sellerIsNq !== true) return "INPUT";
  if (sellerIsNq === false && buyerIsNq === false) return "UNRELATED";
  return "UNKNOWN";
}

export function determineIssuedToNq(buyerName: string | null, buyerTaxCode: string | null) {
  return determinePartyIsNq(buyerName, buyerTaxCode);
}

export function normalizeInvoiceNumber(value: string | null | undefined) {
  return (value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Reads the common Vietnamese e-invoice XML structures (TT78 and older TT32 variants). */
export function parseVendorInvoiceXml(buffer: Buffer): ParsedVendorInvoice | null {
  const xml = decodeXml(buffer);
  if (!/<[^>]*(HDon|Invoice|SHDon|SoHDon)\b/i.test(xml)) return null;

  const sellerSection = findSection(xml, ["NBan", "Seller", "SellerInfo"]);
  const buyerSection = findSection(xml, ["NMua", "Buyer", "BuyerInfo"]);
  const generalSection = findSection(xml, ["TTChung", "GeneralInfo", "InvoiceData"]);
  const paymentSection = findSection(xml, ["TToan", "Payment", "PaymentInfo"]);

  const sellerName = findTag(sellerSection || xml, ["Ten", "Name", "SellerName"]);
  const sellerTaxCode = findTag(sellerSection || xml, ["MST", "TaxCode", "SellerTaxCode"]);
  const buyerName = findTag(buyerSection || xml, ["Ten", "Name", "BuyerName"]);
  const buyerTaxCode = findTag(buyerSection || xml, ["MST", "TaxCode", "BuyerTaxCode"]);
  const invoiceNumber = findTag(generalSection || xml, ["SHDon", "SoHDon", "InvoiceNumber", "InvoiceNo"]);
  const invoiceSymbol = findTag(generalSection || xml, ["KHHDon", "KHMSHDon", "InvoiceSymbol", "TemplateCode"]);
  const invoiceDateRaw = findTag(generalSection || xml, ["NLap", "NgayLap", "InvoiceDate", "IssueDate"]);
  const subtotal = parseAmount(findTag(paymentSection || xml, ["TgTCThue", "TgTTCThue", "Subtotal", "TotalBeforeTax"]));
  const taxAmount = parseAmount(findTag(paymentSection || xml, ["TgTThue", "TaxAmount", "TotalTaxAmount"]));
  const totalAmount = parseAmount(findTag(paymentSection || xml, ["TgTTTBSo", "TgTTTSo", "TotalAmount", "AmountDue"]));
  const currency = findTag(generalSection || xml, ["DVTTe", "Currency", "CurrencyCode"]) || "VND";
  const invoiceDirection = determineInvoiceDirection(sellerName, sellerTaxCode, buyerName, buyerTaxCode);
  // Nội dung dòng hàng (chứa "theo tờ khai nhập khẩu số ...") — ưu tiên bảng hàng hóa, không có thì
  // quét toàn bộ text hóa đơn.
  const goodsSection = findSection(xml, ["DSHHDVu", "NDHHDVu", "GoodsList", "Items"]);
  const declarationNumbers = extractDeclarationNumbers(cleanXmlValue(goodsSection ?? xml) ?? "");

  if (!invoiceNumber && !sellerTaxCode && !sellerName) return null;
  return {
    sellerName,
    sellerTaxCode,
    buyerName,
    buyerTaxCode,
    invoiceNumber,
    invoiceSymbol,
    invoiceDate: parseInvoiceDate(invoiceDateRaw),
    subtotal,
    taxAmount,
    totalAmount,
    currency,
    invoiceDirection,
    isIssuedToNq: invoiceDirection === "INPUT" ? true : invoiceDirection === "UNKNOWN" ? null : false,
    declarationNumbers,
  };
}
