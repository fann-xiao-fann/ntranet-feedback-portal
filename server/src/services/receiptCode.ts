import crypto from 'node:crypto';

export const RECEIPT_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const RECEIPT_CODE_REGEX = /^FB-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export function formatDatePart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function generateReceiptCode(now = new Date()): string {
  const datePart = formatDatePart(now);
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += RECEIPT_ALPHABET[bytes[i] % RECEIPT_ALPHABET.length];
  }
  return `FB-${datePart}-${suffix}`;
}

export function normalizeReceiptCode(input: string): string {
  return input.trim().toUpperCase();
}
