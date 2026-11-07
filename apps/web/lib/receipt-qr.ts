import "server-only";
import QRCode from "qrcode";

/** The scheme and host a receipt's QR code points at: this request's, falling back to the public domain. */
export function receiptOrigin(h: Headers): { host: string; origin: string } {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "www.ballottrack.org";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return { host, origin: `${proto}://${host}` };
}

/** SVG QR code for a ballot's tracker URL. 4-module quiet zone (design system README, Print). */
export function receiptQrSvg(origin: string, trackingCode: string): Promise<string> {
  return QRCode.toString(`${origin}/track/${trackingCode}`, { type: "svg", margin: 4, errorCorrectionLevel: "M" });
}
