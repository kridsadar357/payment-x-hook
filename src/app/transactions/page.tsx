import Link from "next/link";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

type UiStatus = "paid" | "cancelled" | "expired";

function normalizeStatus(raw: string | undefined): UiStatus {
  if (raw === "cancelled") return "cancelled";
  if (raw === "expired") return "expired";
  return "paid";
}

function normalizePage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function statusLabel(s: UiStatus): string {
  if (s === "paid") return "สำเร็จ";
  if (s === "cancelled") return "ยกเลิก";
  return "เกินเวลา";
}

function statusBadgeClass(s: UiStatus): string {
  if (s === "paid") return "border-emerald-400/35 bg-emerald-400/10 text-emerald-300";
  if (s === "cancelled") return "border-rose-400/35 bg-rose-400/10 text-rose-300";
  return "border-amber-400/35 bg-amber-400/10 text-amber-300";
}

function hrefFor(status: UiStatus, page: number): string {
  return `/transactions?status=${status}&page=${page}`;
}

function formatBaht(n: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDateTime(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(d);
}

function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export default async function TransactionsPage(props: {
  searchParams?: { status?: string; page?: string };
}) {
  const activeStatus = normalizeStatus(props.searchParams?.status);
  const currentPage = normalizePage(props.searchParams?.page);

  const where = { status: activeStatus };
  const total = await prisma.paymentSession.count({ where });
  const aggregate = await prisma.paymentSession.aggregate({
    where,
    _sum: { amount: true },
  });
  const totalAmount = Number(aggregate._sum.amount ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const skip = (page - 1) * PAGE_SIZE;

  const rows = await prisma.paymentSession.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    skip,
    take: PAGE_SIZE,
  });

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#0b0c10] px-4 py-6 pb-28 text-zinc-100 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(16,185,129,0.18),transparent_42%),radial-gradient(circle_at_88%_8%,rgba(59,130,246,0.16),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_40%)]" />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_1px,transparent_1px,transparent_16px)]" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">รายการธุรกรรม</h1>
            <p className="mt-1 text-xs text-zinc-500">
              ดูสถานะ {statusLabel(activeStatus)} · หน้า {page}/{totalPages} · ทั้งหมด {total} รายการ
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/90">ยอดรวม</p>
              <p className="text-sm font-extrabold text-emerald-300">{formatBaht(totalAmount)}</p>
            </div>
            <Link
              href="/"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
            >
              ← กลับหน้าชำระ
            </Link>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(["paid", "cancelled", "expired"] as UiStatus[]).map((s) => {
            const on = s === activeStatus;
            return (
              <Link
                key={s}
                href={hrefFor(s, 1)}
                className={
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
                  (on
                    ? statusBadgeClass(s)
                    : "border-white/15 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200")
                }
              >
                {statusLabel(s)}
              </Link>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 shadow-2xl shadow-black/40">
          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-semibold text-zinc-300">ยังไม่มีรายการสถานะ {statusLabel(activeStatus)}</p>
              <p className="mt-1 text-xs text-zinc-500">เมื่อมีรายการใหม่ ระบบจะแสดงที่หน้านี้อัตโนมัติ</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">เวลา</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Hook</th>
                    <th className="px-4 py-3 font-semibold">Session</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm text-zinc-200">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-white/[0.02]">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatDateTime(
                          activeStatus === "paid" ? r.paidAt : r.updatedAt,
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-semibold text-emerald-400">
                        {formatBaht(Number(r.amount))}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-400">{r.notifySlug ?? "-"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500">{shortId(r.id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0b0c10]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href={hrefFor(activeStatus, Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={
              "rounded-lg border px-3 py-2 text-xs font-semibold transition " +
              (page <= 1
                ? "pointer-events-none border-white/10 bg-white/[0.03] text-zinc-600"
                : "border-white/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]")
            }
          >
            ← ก่อนหน้า
          </Link>
          <p className="text-xs text-zinc-400">หน้า {page} / {totalPages}</p>
          <Link
            href={hrefFor(activeStatus, Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={
              "rounded-lg border px-3 py-2 text-xs font-semibold transition " +
              (page >= totalPages
                ? "pointer-events-none border-white/10 bg-white/[0.03] text-zinc-600"
                : "border-white/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]")
            }
          >
            ถัดไป →
          </Link>
        </div>
      </div>
    </div>
  );
}

