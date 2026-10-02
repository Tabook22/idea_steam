import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRecorder } from "@/components/recorder-provider";
import { useLanguage } from "@/lib/i18n";

const BUNDLE = /assets\/index-[\w-]+\.js/;

/**
 * Tells you when a newer version has been deployed, so an open tab or installed app
 * never keeps running old code. Checks on return to the app and every 10 minutes.
 */
export function UpdateNotice() {
  const { isArabic } = useLanguage();
  const { stage } = useRecorder();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const current = [...document.scripts].map((script) => script.src.match(BUNDLE)?.[0]).find(Boolean);
    if (!current) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}?version-check=${Date.now()}`, { cache: "no-store", credentials: "include" });
        const latest = response.ok ? (await response.text()).match(BUNDLE)?.[0] : undefined;
        if (!stopped && latest && latest !== current) setReady(true);
      } catch { /* Offline or signed out: try again later. */ }
    };
    const timer = window.setInterval(check, 10 * 60_000);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, []);

  // Never interrupt a recording; the notice waits until it is saved.
  if (!ready || stage !== "idle") return null;
  return (
    <div className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-[hsl(158_38%_14%)] p-2.5 ps-4 text-sm text-white shadow-2xl" role="status">
      <RefreshCw size={16} className="shrink-0 text-emerald-300" />
      <span className="min-w-0 flex-1">{isArabic ? "يتوفر إصدار جديد من التطبيق." : "A new version of the app is ready."}</span>
      <button type="button" onClick={() => window.location.reload()} className="h-9 shrink-0 rounded-full bg-white px-4 font-semibold text-[hsl(158_38%_14%)]">
        {isArabic ? "تحديث" : "Reload"}
      </button>
    </div>
  );
}
