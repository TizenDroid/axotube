import qrcode from "qrcode-npm";
import { createBoundedCache } from "../shared/boundedCache.js";

const qrcodes = createBoundedCache(50);

// Returns a data: URL for a QR code of `link`, cached per link. Null on failure.
export function generateQRCode(link) {
  if (qrcodes.has(link)) return qrcodes.get(link);
  try {
    const qr = qrcode.qrcode(6, "H");
    qr.addData(link);
    qr.make();
    const qrDataImgTag = qr.createImgTag(8, 8);
    const qrDataUrl = qrDataImgTag.match(/src="([^"]+)"/)?.[1];
    if (qrDataUrl) {
      qrcodes.set(link, qrDataUrl);
      return qrDataUrl;
    }
  } catch (e) {
    console.error("[AxoTube:qrCode] QR code generation failed:", e);
  }
  return null;
}
