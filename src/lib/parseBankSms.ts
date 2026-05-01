/**
 * Parse Thai mobile banking SMS lines such as:
 * - 28/04/69 18:11 บช X-7230 รับโอนจาก X-8137 160.00 คงเหลือ 226.88 บ.
 * - 23/04/69 16:36 หักบช X-7230 เข้าพร้อมเพย์ X-8796 400.00 คงเหลือ 66.88 บ.
 * - 23/04/69 20:06 บช X-7230 เงินเข้า 1,000.00 คงเหลือ 1,066.88 บ.
 */

export type ParsedBankSms = {
  transferAmount: number;
  occurredAt: Date;
  rawDate: string;
  rawTime: string;
};

const THAI_UTC_OFFSET_MINUTES = 7 * 60;

/** แปลงเวลา local ไทย (ICT, UTC+7) เป็น UTC instant เพื่อให้เทียบกับ createdAt ได้ตรงบนเซิร์ฟเวอร์ UTC */
function toUtcFromThaiLocal(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const utcMs = Date.UTC(year, monthIndex, day, hour, minute, 0, 0) - THAI_UTC_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs);
}

/** DD/MM/YY or DD/MM/YYYY at line start; YY/YYYY = Buddhist era in bank SMS. */
export function parseThaiBankSmsMessage(text: string): ParsedBankSms | null {
  const trimmed = text.trim();
  const head = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (!head) return null;

  const [, dStr, moStr, yRaw, hStr, miStr] = head;
  const y = Number(yRaw);
  const beYear = y < 100 ? 2500 + y : y;
  const ceYear = beYear - 543;
  const occurredAt = toUtcFromThaiLocal(
    ceYear,
    Number(moStr) - 1,
    Number(dStr),
    Number(hStr),
    Number(miStr),
  );
  if (Number.isNaN(occurredAt.getTime())) return null;

  const balIdx = trimmed.indexOf("คงเหลือ");
  if (balIdx === -1) return null;

  const beforeBalance = trimmed.slice(0, balIdx);
  const moneyRe = /([\d,]+\.\d{2})/g;
  let m: RegExpExecArray | null;
  let lastAmt: string | null = null;
  while ((m = moneyRe.exec(beforeBalance)) !== null) lastAmt = m[1];
  if (lastAmt === null) return null;
  const transferAmount = parseFloat(lastAmt.replace(/,/g, ""));
  if (!Number.isFinite(transferAmount)) return null;

  return {
    transferAmount,
    occurredAt,
    rawDate: `${dStr}/${moStr}/${yRaw}`,
    rawTime: `${hStr}:${miStr}`,
  };
}

export function amountsMatch(a: number, b: number, eps = 0.005): boolean {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= Math.round(eps * 100);
}

/** SMS time must be >= session start - earlySlack and <= session start + lateMs */
export function isWithinTransferWindow(
  smsTimeMs: number,
  sessionCreatedAtMs: number,
  earlySlackMs: number,
  lateMs: number,
): boolean {
  return smsTimeMs >= sessionCreatedAtMs - earlySlackMs && smsTimeMs <= sessionCreatedAtMs + lateMs;
}
