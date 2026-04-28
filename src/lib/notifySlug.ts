/** คีย์สำหรับ path /api/payments/notify/ev/2 — อนุญาต a-z A-Z 0-9 / _ - (ใช้ได้ทั้งฝั่ง client) */
export function normalizeNotifySlug(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s || s.length > 191) return null;
  if (!/^[a-zA-Z0-9/_-]+$/.test(s)) return null;
  return s;
}
