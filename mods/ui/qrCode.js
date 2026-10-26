import qrcode from "qrcode-npm";

const qrcodes = {};

// Returns a data: URL for a QR code of `link`, cached per link. Null on failure.
export function generateQRCode(link) {
  if (qrcodes[link]) return qrcodes[link];
  try {
    const qr = qrcode.qrcode(6, "H");
    qr.addData(link);
    qr.make();
    const qrDataImgTag = qr.createImgTag(8, 8);
    const qrDataUrl = qrDataImgTag.match(/src="([^"]+)"/)?.[1];
    if (qrDataUrl) {
      qrcodes[link] = qrDataUrl;
      return qrDataUrl;
    }
  } catch (e) {
    console.error("QR code generation failed:", e);
  }
  return null;
}
