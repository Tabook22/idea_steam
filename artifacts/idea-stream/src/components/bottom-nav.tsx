import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { AudioLines, Home, Mic, Plus, Search } from "lucide-react";
import { useListSubjects } from "@workspace/api-client-react";
import { useRecorder } from "@/components/recorder-provider";
import { openCapture } from "@/components/capture-sheet";
import { openSearch } from "@/components/workspace-search";
import { usePressToTalk } from "@/components/press-to-talk";
import { isInbox } from "@/lib/inbox";
import { useLanguage } from "@/lib/i18n";
import { useRecorderPrefs } from "@/lib/recorder-prefs";

function Tab({ label, icon, active, badge, href, onClick }: {
  label: string; icon: ReactNode; active?: boolean; badge?: number; href?: string; onClick?: () => void;
}) {
  const body = (
    <>
      <span className="relative">
        {icon}
        {!!badge && (
          <span className="absolute -end-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </>
  );
  const className = `flex h-full flex-col items-center justify-center gap-1 transition-colors ${active ? "text-primary" : "text-muted-foreground active:text-foreground"}`;
  return href ? (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>{body}</Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>{body}</button>
  );
}

/** Phone navigation with a raised REC button: tap to record, hold to talk. */
export function BottomNav() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [location] = useLocation();
  const { start, stage, ready, rescue, records } = useRecorder();
  const { data: subjects = [] } = useListSubjects();
  const [prefs] = useRecorderPrefs();

  const notebook = Number(location.match(/^\/subjects\/(\d+)/)?.[1]) || null;
  const remembered = prefs.subjectId !== null && subjects.some((s) => s.id === prefs.subjectId && !isInbox(s)) ? prefs.subjectId : null;
  const target = notebook ?? remembered;
  const inboxIds = new Set(subjects.filter(isInbox).map((s) => s.id));
  const toSort = records.filter((r) => r.status !== "recording" && (r.subjectId === null || inboxIds.has(r.subjectId))).length;
  const options = { language: prefs.language, autoTranscribe: prefs.autoTranscribe };
  const talk = usePressToTalk({
    disabled: !ready || !!rescue || stage !== "idle",
    onTap: () => void start(target, prefs.limit, options),
    onHoldStart: () => void start(target, prefs.limit, { ...options, hold: true }),
  });

  if (location.startsWith("/share")) return null;
  return (
    <>
      {/* Keeps page content clear of the bar. */}
      <div aria-hidden="true" className="h-[calc(5rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label={copy("Main", "التنقل الرئيسي")}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/90 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-stretch">
          <Tab href="/app" label={copy("Home", "الرئيسية")} icon={<Home size={22} />} active={location === "/app" || location === "/"} />
          <Tab label={copy("Search", "بحث")} icon={<Search size={22} />} onClick={openSearch} />
          <div className="relative flex justify-center">
            <button
              type="button"
              {...talk}
              disabled={!ready || !!rescue || stage !== "idle"}
              aria-label={notebook
                ? copy("Record into this notebook: tap, or hold to talk", "سجّل في هذا الدفتر: انقر أو اضغط مطولًا وتحدث")
                : copy("Record: tap, or hold to talk", "سجّل: انقر أو اضغط مطولًا وتحدث")}
              className="absolute -top-6 grid h-[4.25rem] w-[4.25rem] touch-none select-none place-items-center rounded-full bg-gradient-to-br from-rose-400 via-red-500 to-red-700 text-white shadow-[0_10px_24px_-6px_rgba(220,38,38,0.6)] ring-4 ring-card transition active:scale-90 disabled:opacity-60 [-webkit-touch-callout:none]"
            >
              <span className="flex flex-col items-center">
                <Mic size={26} strokeWidth={1.9} />
                <span className="mt-0.5 text-[9px] font-bold tracking-[0.14em]">REC</span>
              </span>
            </button>
            <span className="pointer-events-none absolute bottom-1.5 text-[10px] font-medium text-muted-foreground">
              {copy("hold to talk", "اضغط وتحدث")}
            </span>
          </div>
          <Tab label={copy("Add", "إضافة")} icon={<Plus size={24} />} onClick={openCapture} />
          <Tab href="/record" label={copy("Voice notes", "الملاحظات")} icon={<AudioLines size={22} />} active={location.startsWith("/record")} badge={toSort} />
        </div>
      </nav>
    </>
  );
}
