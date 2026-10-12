/** Types for the vendored uqr QR code generator (only what the app uses). */
export interface QrCodeResult {
  version: number;
  size: number;
  /** true for a dark module, row by row. */
  data: boolean[][];
}
export function encode(data: string, options?: { ecc?: "L" | "M" | "Q" | "H"; border?: number; boostEcc?: boolean }): QrCodeResult;
