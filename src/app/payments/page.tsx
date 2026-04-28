import { redirect } from "next/navigation";

type Props = { searchParams: { hook?: string | string[] } };

/** เส้นทางเก่า — ส่งต่อไปหน้าหลักพร้อม query */
export default function LegacyPaymentsPath({ searchParams }: Props) {
  const raw = searchParams.hook;
  const hook = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (hook) {
    redirect(`/?hook=${encodeURIComponent(hook)}`);
  }
  redirect("/");
}
