"use client";

import { Kanit } from "next/font/google";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { normalizeNotifySlug } from "@/lib/notifySlug";
import QRCode from "qrcode";
import generatePayload from "promptpay-qr";

const payFont = Kanit({
  subsets: ["latin", "thai"],
  weight: ["600", "700", "800"],
  variable: "--font-pay",
  display: "swap",
});

const PRESETS = [50, 100, 200, 500, 1000] as const;
const MIN_BAHT = 10;
const MAX_BAHT = 999_999;
const QR_SIZE = 176;
const TRANSFER_COUNTDOWN_MS = 150_000;

function formatMmSs(totalSec: number): string {
  const m = Math.floor(Math.max(0, totalSec) / 60);
  const s = Math.max(0, totalSec) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const NUMPAD_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "⌫"],
] as const;

function formatBaht(n: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatReceiptDatetime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(d);
}

function playReceiptPrintSfx(): void {
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const now = ctx.currentTime;
  const hit = (at: number, freq: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.035, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.01);
  };
  hit(now + 0.00, 900, 0.06);
  hit(now + 0.08, 760, 0.06);
  hit(now + 0.16, 620, 0.08);
  window.setTimeout(() => void ctx.close(), 500);
}

/** แบ่งยอดแสดงผลสองบรรทัดให้ใกล้เคียง mock ใน design */
function splitOrderLines(total: number): { energy: number; session: number } {
  const energy = Math.round(total * 0.704 * 100) / 100;
  return { energy, session: Math.round((total - energy) * 100) / 100 };
}

function normalizeNumpad(prev: string, key: string): string {
  if (key === "⌫") return prev.slice(0, -1);
  if (key === ".") {
    if (prev.includes(".")) return prev;
    return prev === "" ? "0." : `${prev}.`;
  }
  if (!/^\d$/.test(key)) return prev;

  if (prev.includes(".")) {
    const [a, frac = ""] = prev.split(".");
    if (frac.length >= 2) return prev;
    const next = `${a}.${frac}${key}`;
    const n = parseFloat(next);
    if (!Number.isFinite(n) || n > MAX_BAHT) return prev;
    return next;
  }

  const next = prev === "0" ? key : `${prev}${key}`;
  const n = parseFloat(next);
  if (!Number.isFinite(n) || n > MAX_BAHT) return prev;
  return next;
}

function IconBolt(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden>
      <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
    </svg>
  );
}

function IconClock(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}

function IconLock(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

function IconChevron(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden>
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={props.className} aria-hidden>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaymentsPageInner() {
  const searchParams = useSearchParams();
  /** ผูกกับ URL Shortcut แบบ /api/payments/notify/ev/2 — ใช้ ?hook=ev/2 หรือ NEXT_PUBLIC_PAYMENT_NOTIFY_SLUG */
  const notifySlugForHook = useMemo(() => {
    const fromQuery = normalizeNotifySlug(searchParams.get("hook"));
    if (fromQuery) return fromQuery;
    return normalizeNotifySlug(process.env.NEXT_PUBLIC_PAYMENT_NOTIFY_SLUG ?? null);
  }, [searchParams]);

  const promptPayId = (process.env.NEXT_PUBLIC_PROMPTPAY_ID ?? "").replace(/\s/g, "");
  const [amount, setAmount] = useState<number>(100);
  const [numpadRaw, setNumpadRaw] = useState("100");
  const [lockedAmount, setLockedAmount] = useState<number | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [transferDeadline, setTransferDeadline] = useState(() => Date.now() + TRANSFER_COUNTDOWN_MS);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [paySessionId, setPaySessionId] = useState<string | null>(null);
  const [paidSuccess, setPaidSuccess] = useState(false);
  const [paidAtText, setPaidAtText] = useState<string | null>(null);
  const receiptSoundEnabled = process.env.NEXT_PUBLIC_RECEIPT_SOUND === "1";

  const digitsOnly = useCallback((s: string) => s.replace(/\D/g, ""), []);

  const editing = lockedAmount === null && !paidSuccess;
  const displayTotal = lockedAmount ?? amount;
  const lines = useMemo(() => splitOrderLines(displayTotal), [displayTotal]);

  const showSimulatePaidButton =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_PAYMENTS_SIMULATE === "1";

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const transferSecondsLeft = Math.max(0, Math.ceil((transferDeadline - nowTick) / 1000));
  const transferExpired =
    lockedAmount !== null && !paidSuccess && transferSecondsLeft <= 0;

  const applyNumpadRaw = useCallback((raw: string) => {
    if (raw === "" || raw === ".") return;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < MIN_BAHT) return;
    const rounded = Math.round(parsed * 100) / 100;
    if (rounded > MAX_BAHT) return;
    setAmount(rounded);
  }, []);

  const onNumpadKey = useCallback(
    (key: string) => {
      if (!editing) return;
      if (key === "C") {
        setNumpadRaw("100");
        setAmount(100);
        return;
      }
      const next = normalizeNumpad(numpadRaw, key);
      if (next === "") {
        setNumpadRaw("100");
        setAmount(100);
        return;
      }
      setNumpadRaw(next);
      applyNumpadRaw(next);
    },
    [numpadRaw, applyNumpadRaw, editing],
  );

  const resetToSelectAmount = useCallback(() => {
    setLockedAmount(null);
    setQrDataUrl(null);
    setQrError(null);
    setConfirmLoading(false);
    setPaySessionId(null);
    setPaidSuccess(false);
    setPaidAtText(null);
  }, []);

  const markPaidSuccess = useCallback((paidAtIso?: string | null) => {
    setPaidSuccess(true);
    setQrDataUrl(null);
    setQrError(null);
    if (receiptSoundEnabled) playReceiptPrintSfx();
    if (paidAtIso) {
      const d = new Date(paidAtIso);
      setPaidAtText(Number.isNaN(d.getTime()) ? formatReceiptDatetime(new Date()) : formatReceiptDatetime(d));
      return;
    }
    setPaidAtText(formatReceiptDatetime(new Date()));
  }, [receiptSoundEnabled]);

  /** หมดเวลาโอน → กลับไปขั้นตอนเลือกยอดอัตโนมัติ */
  useEffect(() => {
    if (!transferExpired) return;
    resetToSelectAmount();
  }, [transferExpired, resetToSelectAmount]);

  /** Poll session status เพื่ออัปเดตหน้าเป็น "ชำระสำเร็จ" อัตโนมัติหลัง webhook notify */
  useEffect(() => {
    if (!paySessionId || paidSuccess || lockedAmount === null) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/payments/session/${encodeURIComponent(paySessionId)}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string; paidAt?: string | null };
        if (cancelled) return;
        if (data.status === "paid") {
          markPaidSuccess(data.paidAt ?? null);
        } else if (data.status === "expired_or_cancelled") {
          resetToSelectAmount();
        }
      } catch {
        // Ignore transient polling failures; next tick will retry.
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [paySessionId, paidSuccess, lockedAmount, markPaidSuccess, resetToSelectAmount]);

  const handleConfirm = useCallback(async () => {
    if (numpadRaw === "" || numpadRaw === ".") return;
    const parsed = parseFloat(numpadRaw);
    if (!Number.isFinite(parsed) || parsed < MIN_BAHT) return;
    const rounded = Math.round(parsed * 100) / 100;
    if (rounded > MAX_BAHT) return;

    setConfirmLoading(true);
    setQrError(null);
    try {
      const res = await fetch("/api/payments/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: rounded,
          ...(notifySlugForHook ? { notifySlug: notifySlugForHook } : {}),
        }),
      });
      if (!res.ok) {
        setQrError("ไม่สามารถสร้างรายการชำระได้");
        setConfirmLoading(false);
        return;
      }
      const data = (await res.json()) as { sessionId?: string };
      if (data.sessionId) setPaySessionId(data.sessionId);
      setLockedAmount(rounded);
      setAmount(rounded);
      setTransferDeadline(Date.now() + TRANSFER_COUNTDOWN_MS);
    } catch {
      setQrError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ");
    } finally {
      setConfirmLoading(false);
    }
  }, [numpadRaw, notifySlugForHook]);

  useEffect(() => {
    if (paidSuccess) return;

    if (lockedAmount === null) {
      setQrDataUrl(null);
      setQrError(null);
      return;
    }

    const id = digitsOnly(promptPayId);
    if (id.length < 10) {
      setQrDataUrl(null);
      setQrError(
        id.length === 0
          ? "ตั้งค่า NEXT_PUBLIC_PROMPTPAY_ID ใน .env.local"
          : "รหัสพร้อมเพย์ในการตั้งค่าไม่ถูกต้อง",
      );
      return;
    }

    let cancelled = false;
    setQrError(null);

    (async () => {
      try {
        const payload = generatePayload(promptPayId, { amount: lockedAmount });
        const url = await QRCode.toDataURL(payload, {
          width: QR_SIZE,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#0a0a0b", light: "#ffffff" },
        });
        if (!cancelled) {
          setQrDataUrl(url);
          setQrError(null);
        }
      } catch {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrError("สร้าง QR ไม่สำเร็จ");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lockedAmount, paidSuccess, promptPayId, digitsOnly]);

  return (
    <div
      className={`${payFont.variable} relative h-[100dvh] max-h-[100dvh] overflow-x-hidden overflow-y-hidden font-[family-name:var(--font-pay)] text-[0.875rem] leading-normal antialiased`}
    >
      {/* Full-bleed hero — เต็มจอแบบ object-cover ขนาดปกติ ไม่ซูม/ไม่ล้น (ไม่ใช้ overscan) */}
      <div className="absolute inset-0 min-h-[100dvh] overflow-hidden bg-[#0a0a0a]">
        <Image
          src="/payment_design.png"
          alt=""
          fill
          quality={95}
          className={
            "object-cover object-[58%_42%] sm:object-[54%_40%] md:object-[50%_38%] lg:object-[48%_36%] xl:object-[45%_34%] " +
            "brightness-[1.05] contrast-[1.08] saturate-[1.1]"
          }
          priority
          sizes="100vw"
        />
        <div
          className={
            "pointer-events-none absolute inset-0 " +
            "bg-[linear-gradient(102deg,rgba(0,0,0,.86)_0%,rgba(0,0,0,.44)_26%,rgba(0,0,0,.14)_45%,rgba(0,0,0,.04)_58%,transparent_72%)] " +
            "max-sm:bg-[linear-gradient(102deg,rgba(0,0,0,.92)_0%,rgba(0,0,0,.52)_32%,rgba(0,0,0,.2)_50%,rgba(0,0,0,.07)_64%,transparent_80%)]"
          }
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -right-[8%] top-[18%] h-[min(58vmin,520px)] w-[min(58vmin,520px)] rounded-full bg-cyan-400/[0.15] blur-[52px] motion-safe:animate-pay-orb-1 motion-reduce:opacity-[0.14]" />
          <div className="absolute bottom-[12%] right-[10%] h-[min(42vmin,380px)] w-[min(42vmin,380px)] rounded-full bg-emerald-400/[0.12] blur-[44px] motion-safe:animate-pay-orb-2 motion-reduce:opacity-[0.1]" />
        </div>
      </div>

      {/* Floating card: centered + full safe-area on small screens; shifts right on md+ to sit nearer the charger */}
      <div
        className={
          "pointer-events-none absolute inset-0 z-20 flex items-center justify-center " +
          "pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] " +
          "pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] " +
          "md:justify-start md:pl-[max(1rem,calc(clamp(1.5rem,9vw,6.5rem)+env(safe-area-inset-left)))] " +
          "md:pr-[max(1rem,calc(0.75rem+env(safe-area-inset-right)))] " +
          "lg:pl-[max(1.25rem,calc(clamp(2.25rem,11vw,7.5rem)+env(safe-area-inset-left)))] " +
          "xl:pl-[max(1.5rem,calc(clamp(3rem,15vw,11rem)+env(safe-area-inset-left)))] " +
          "2xl:pl-[max(2rem,calc(clamp(3.5rem,18vw,14rem)+env(safe-area-inset-left)))]"
        }
      >
        <div
          className={
            "pointer-events-auto w-full max-w-[min(22rem,calc(100vw-1.5rem-env(safe-area-inset-left)-env(safe-area-inset-right)))] " +
            "max-h-[min(calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)),920px)] " +
            "shrink-0 overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-zinc-950/82 p-4 " +
            "shadow-[0_25px_50px_-12px_rgba(0,0,0,0.65)] shadow-black/60 backdrop-blur-xl ring-1 ring-white/[0.07] " +
            "opacity-0 motion-safe:animate-pay-card-in motion-reduce:animate-none motion-reduce:opacity-100 " +
            "sm:max-w-[min(28rem,calc(100vw-2rem-env(safe-area-inset-left)-env(safe-area-inset-right)))] sm:rounded-3xl sm:p-5"
          }
        >
        <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
          {paidSuccess ? "สำเร็จ" : "ชำระเงิน"}
        </h1>
        <p
          className={
            "mt-1 max-w-sm text-xs leading-snug " +
            (paidSuccess ? "text-emerald-400/85" : "text-zinc-500")
          }
        >
          {paidSuccess
            ? "การชำระผ่านพร้อมเพย์ได้รับการยืนยันแล้ว"
            : "ยืนยันยอดเพื่อเริ่มชาร์จ — สแกน QR พร้อมเพย์เมื่อพร้อม"}
        </p>

        {/* Order summary */}
        <div className="mt-4 rounded-xl border border-white/10 bg-zinc-900/55 p-3 shadow-lg shadow-black/30 backdrop-blur-md sm:p-4">
          <div className="flex items-start gap-2 border-b border-white/5 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-400">
              <IconBolt className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">ค่าพลังงาน</p>
              <p className="text-[10px] leading-tight text-zinc-500">ชาร์จเร็ว · TRS Fast Charge 160 kW</p>
            </div>
            <p className="shrink-0 text-xs font-semibold tabular-nums text-zinc-300">
              {formatBaht(lines.energy)}
            </p>
          </div>
          <div className="flex items-start gap-2 border-b border-white/5 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-400">
              <IconClock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">ค่าเซสชัน / เวลา</p>
              <p className="text-[10px] leading-tight text-zinc-500">ประมาณการจากยอดรวม</p>
            </div>
            <p className="shrink-0 text-xs font-semibold tabular-nums text-zinc-300">
              {formatBaht(lines.session)}
            </p>
          </div>
          <div className="flex items-center justify-between pt-3">
            <span className="text-xs font-medium text-zinc-400">ยอดรวม</span>
            <span className="text-lg font-bold tabular-nums text-emerald-400 motion-safe:animate-pay-total-glow motion-reduce:animate-none sm:text-xl">
              {formatBaht(displayTotal)}
            </span>
          </div>
          {lockedAmount !== null && !paidSuccess && (
            <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/90">
                เวลาโอน (เหลือ)
              </p>
              <p
                className={
                  "mt-0.5 font-mono text-base font-extrabold tabular-nums " +
                  (transferExpired ? "text-amber-400" : "text-emerald-300")
                }
              >
                {formatMmSs(transferSecondsLeft)}
              </p>
              <p className="mt-1 text-[10px] text-zinc-500">
                {transferExpired
                  ? "หมดเวลา — กดเลือกยอดใหม่"
                  : "โอนภายใน 2.5 นาทีหลังยืนยัน"}
              </p>
            </div>
          )}
          {paySessionId && !paidSuccess && (
            <div className="mt-3 rounded-lg border border-white/5 bg-black/20 px-2 py-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                Session (SMS notify)
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">{paySessionId}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(paySessionId)}
                  className="shrink-0 rounded-md border border-zinc-600 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-white/5"
                >
                  คัดลอก
                </button>
              </div>
            </div>
          )}
        </div>

        {!paidSuccess ? (
          <>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          เลือกวิธีชำระ
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5 rounded-xl border-2 border-emerald-400/60 bg-emerald-400/[0.07] px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-400">
              <IconCheck className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">QR / พร้อมเพย์</p>
              <p className="text-[10px] text-zinc-500">สแกนจ่ายผ่านแอปธนาคาร</p>
            </div>
          </div>
        </div>

        {lockedAmount !== null && (
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
              สแกน QR พร้อมเพย์
            </p>
            <div className="relative mt-2 rounded-2xl border-2 border-emerald-400/50 bg-white p-2.5 shadow-inner shadow-black/20 ring-2 ring-emerald-400/20">
              <div
                className="pointer-events-none absolute -inset-0.5 rounded-2xl border border-emerald-400/70 motion-safe:animate-pay-border-shimmer motion-reduce:animate-none"
                aria-hidden
              />
              <div className="relative">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL
                <img
                  src={qrDataUrl}
                  alt="PromptPay QR"
                  width={QR_SIZE}
                  height={QR_SIZE}
                  className="mx-auto h-auto w-full max-w-[200px] rounded-xl"
                />
              ) : (
                <div
                  className="mx-auto flex aspect-square w-full max-w-[200px] flex-col items-center justify-center gap-1 rounded-xl bg-zinc-100 p-3 text-center"
                  role="status"
                >
                  <span className="text-2xl text-zinc-400" aria-hidden>
                    ◌
                  </span>
                  <p className="text-[10px] font-semibold text-zinc-600">{qrError ?? "กำลังเตรียม QR…"}</p>
                </div>
              )}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] font-semibold text-emerald-400">
              {formatBaht(lockedAmount)} · พร้อมเพย์
            </p>
            {showSimulatePaidButton && (
              <button
                type="button"
                onClick={() => markPaidSuccess()}
                className="mt-3 w-full rounded-xl border border-dashed border-amber-400/45 bg-amber-400/10 py-2.5 text-[11px] font-bold text-amber-200/95 transition hover:bg-amber-400/15"
              >
                จำลองชำระสำเร็จ (ทดสอบ)
              </button>
            )}
          </div>
        )}

        {editing && (
          <>
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">ทางลัด</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PRESETS.map((n) => {
                  const on = amount === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setAmount(n);
                        setNumpadRaw(String(n));
                      }}
                      className={
                        "min-w-[2.75rem] rounded-full border px-2.5 py-1.5 text-xs font-bold transition " +
                        (on
                          ? "border-emerald-400 bg-emerald-400/15 text-emerald-300"
                          : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600")
                      }
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-zinc-900/50 p-2.5">
              <div className="mb-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/80">ยอด (บาท)</p>
                <p className="mt-0.5 min-h-[1.75rem] text-right text-lg font-extrabold tabular-nums text-white sm:text-xl">
                  {numpadRaw === "" ? <span className="text-zinc-600">0</span> : numpadRaw}
                </p>
                <p className="mt-0.5 text-right text-[10px] text-zinc-500">
                  {numpadRaw !== "" &&
                  !Number.isNaN(parseFloat(numpadRaw)) &&
                  parseFloat(numpadRaw) >= MIN_BAHT
                    ? formatBaht(Math.round(parseFloat(numpadRaw) * 100) / 100)
                    : "—"}
                </p>
                <p className="mt-0.5 text-right text-[9px] text-zinc-600">ขั้นต่ำ {formatBaht(MIN_BAHT)}</p>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {NUMPAD_KEYS.flatMap((row) =>
                  row.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onNumpadKey(key)}
                      className={
                        "flex h-9 items-center justify-center rounded-lg border text-sm font-bold transition active:scale-[0.97] sm:h-10 " +
                        (key === "⌫"
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15"
                          : "border-zinc-700/80 bg-zinc-800/80 text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800")
                      }
                    >
                      {key}
                    </button>
                  )),
                )}
              </div>
              <button
                type="button"
                onClick={() => onNumpadKey("C")}
                className="mt-1.5 w-full rounded-lg border border-dashed border-zinc-600 py-1.5 text-[10px] font-bold text-zinc-400 transition hover:bg-white/5"
              >
                ล้าง
              </button>
            </div>

            <button
              type="button"
              disabled={
                confirmLoading ||
                numpadRaw === "" ||
                Number.isNaN(parseFloat(numpadRaw)) ||
                parseFloat(numpadRaw) < MIN_BAHT
              }
              onClick={() => void handleConfirm()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 py-2.5 text-sm font-bold text-zinc-900 shadow-md shadow-emerald-400/15 transition-all duration-300 hover:bg-emerald-300 motion-safe:hover:scale-[1.02] motion-safe:hover:shadow-lg motion-safe:hover:shadow-emerald-400/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:active:scale-100 disabled:hover:shadow-md"
            >
              <IconLock className="h-4 w-4" />
              {confirmLoading ? "กำลังดำเนินการ…" : `ชำระ ${formatBaht(amount)}`}
              <IconChevron className="h-4 w-4" />
            </button>
            <p className="mt-2 mb-1 flex items-center justify-center gap-1.5 text-center text-[10px] text-zinc-600">
              <IconLock className="h-3 w-3 shrink-0" />
              การชำระเงินปลอดภัย · ยอดล็อกหลังยืนยัน
            </p>
          </>
        )}

        {!editing && lockedAmount !== null && (
          <div className="mt-4 space-y-2 pb-2">
            <button
              type="button"
              onClick={resetToSelectAmount}
              className="w-full rounded-xl border border-zinc-600 bg-zinc-800/50 py-2 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800"
            >
              ← เลือกยอดใหม่
            </button>
          </div>
        )}
          </>
        ) : (
          <div className="mt-6 pb-1">
            <div className="flex flex-col items-center text-center">
              <div
                className={
                  "flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full bg-emerald-400/18 text-emerald-400 " +
                  "ring-4 ring-emerald-400/25 motion-safe:animate-pay-card-in motion-reduce:animate-none"
                }
              >
                <IconCheck className="h-11 w-11" />
              </div>
              <p className="mt-5 text-lg font-extrabold text-white sm:text-xl">ชำระเงินสำเร็จ</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-emerald-400/90">
                Successfully paid
              </p>
              <p className="mt-4 text-2xl font-extrabold tabular-nums text-emerald-400 sm:text-3xl">
                {formatBaht(lockedAmount ?? amount)}
              </p>
              <p className="mt-3 max-w-[16rem] text-[11px] leading-relaxed text-zinc-500">
                สามารถเริ่มชาร์จได้ตามปกติ — ขอบคุณที่ใช้บริการ
              </p>

              <div className="mt-5 w-full max-w-[19rem]">
                <div className="mx-auto h-4 w-[88%] rounded-t-xl border border-white/10 bg-zinc-900/80 shadow-inner shadow-black/60">
                  <div className="mx-auto mt-1 h-1.5 w-[78%] rounded-full bg-black/70" />
                </div>
                <div className="relative">
                  <div
                    className={
                      "receipt-paper-texture relative z-10 mx-auto w-full overflow-hidden rounded-2xl border border-zinc-300/40 bg-zinc-50 px-4 py-3 text-left shadow-xl shadow-black/35 " +
                      "motion-safe:animate-pay-receipt-drop motion-reduce:animate-none"
                    }
                  >
                    <div className="pointer-events-none absolute -top-2 left-0 right-0 flex justify-between px-3" aria-hidden>
                      <span className="h-3 w-3 rounded-full bg-zinc-950/80" />
                      <span className="h-3 w-3 rounded-full bg-zinc-950/80" />
                    </div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Receipt</p>
                    <div className="mt-2 space-y-1.5 font-mono text-[11px] text-zinc-700">
                      <div className="flex items-center justify-between gap-3 border-b border-dashed border-zinc-300 pb-1">
                        <span>AMOUNT</span>
                        <span className="font-extrabold text-zinc-900">{formatBaht(lockedAmount ?? amount)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-b border-dashed border-zinc-300 pb-1">
                        <span>SESSION</span>
                        <span className="max-w-[11rem] truncate text-right">{paySessionId ?? "-"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>PAID AT</span>
                        <span>{paidAtText ?? "-"}</span>
                      </div>
                    </div>
                    <p className="mt-2 border-t border-dashed border-zinc-300 pt-2 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                      Payment Completed
                    </p>
                  </div>
                  <div
                    className={
                      "pointer-events-none absolute left-6 right-6 top-full h-5 rounded-[999px] bg-black/55 blur-md " +
                      "motion-safe:animate-pay-receipt-shadow motion-reduce:animate-none"
                    }
                    aria-hidden
                  />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={resetToSelectAmount}
              className="mt-6 w-full rounded-xl bg-emerald-400 py-2.5 text-sm font-bold text-zinc-900 shadow-md shadow-emerald-400/20 transition hover:bg-emerald-300"
            >
              ชำระครั้งอื่น / เลือกยอดใหม่
            </button>
          </div>
        )}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-30 sm:bottom-4 sm:right-4 lg:bottom-6 lg:right-6">
        <div className="pointer-events-auto flex max-w-[14rem] items-start gap-2 rounded-xl border border-white/10 bg-zinc-950/90 px-2.5 py-2 shadow-lg backdrop-blur-md">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-400">
            <IconLock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-white">ปลอดภัย</p>
            <p className="mt-0.5 text-[9px] leading-snug text-zinc-500">
              ข้อมูลการชำระเงินของคุณได้รับการปกป้อง
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0a] text-sm text-zinc-500">
          กำลังโหลด…
        </div>
      }
    >
      <PaymentsPageInner />
    </Suspense>
  );
}
