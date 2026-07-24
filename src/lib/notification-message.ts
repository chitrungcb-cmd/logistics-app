const LEGACY_SHIPMENT_CODE_SUFFIX = /\s*[-–—]\s*Lô hàng\s+\S+\s*$/iu;

/**
 * Older task notifications stored the internal LH shipment code at the end of the message.
 * Keep those records intact for audit/history, but hide the internal code in user-facing text.
 */
export function notificationMessageForDisplay(message: string) {
  return message.replace(LEGACY_SHIPMENT_CODE_SUFFIX, "").trim();
}
