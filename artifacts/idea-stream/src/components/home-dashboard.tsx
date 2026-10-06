import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Check, Clock3, FileText, Flame, Mic, Pause, PenLine, Play, Shuffle, Sparkles } from "lucide-react";
import { getGetDashboardQueryKey, useGetDashboard, type Dashboard } from "@workspace/api-client-react";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";

const NAME_KEY = "idea-stream-name";
const offset = () => -new Date().getTimezoneOffset();

function readName() {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}

export function greetingFor(hour: number, arabic: boolean) {
  if (hour >= 5 && hour < 12) return arabic ? "صباح الخير" : "Good morning";
  if (hour >= 12 && hour < 17) return arabic ? "طاب يومك" : "Good afternoon";
  if (hour >= 17 && hour < 22) return arabic ? "مساء الخير" : "Good evening";
  return arabic ? "ليلة هادئة" : "Working late";
}

function useDashboard(shuffle = 0) {
  const params = { offset: offset(), shuffle };
  return useGetDashboard(params, { query: { queryKey: getGetDashboardQueryKey(params), staleTime: 30_000, placeholderData: (previous) => previous } });
}

/** One small player shared by the dashboard cards. */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (key: string, url: string) => {
    if (playing === key) { audio.current?.pause(); setPlaying(null); return; }
    const element = audio.current ?? (audio.current = new Audio());
    element.src = appPath(url, import.meta.env.BASE_URL);
    element.onended = () => setPlaying(null);
    void element.play().then(() => setPlaying(key)).catch(() => setPlaying(null));
  };
  return { playing, toggle };
}

/** Greeting, this week in numbers, and the last five weeks as a strip of days. */
export function HomeGreeting() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { data } = useDashboard();
  const [name, setName] = useState(readName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const now = new Date();
  const dayLabel = useMemo(() => new Intl.DateTimeFormat(language, { weekday: "long", month: "long", day: "numeric" }).format(now), [language]); // eslint-disable-line react-hooks/exhaustive-deps
  const shortDay = useMemo(() => new Intl.DateTimeFormat(language, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), [language]);

  const saveName = () => {
    const value = draft.trim().slice(0, 40);
    try { if (value) localStorage.setItem(NAME_KEY, value); else localStorage.removeItem(NAME_KEY); } catch { /* optional */ }
    setName(value);
    setEditing(false);
  };

  const days = data?.days ?? [];
  const busiest = Math.max(1, ...days.map((day) => day.recordings + day.ideas));
  const activeDays = days.filter((day) => day.recordings + day.ideas > 0).length;

  return (
    <section aria-label={copy("Your week", "أسبوعك")}
      className="relative mb-5 overflow-hidden rounded-[1.75rem] border bg-card px-5 py-5 shadow-sm sm:px-7 sm:py-6">
      <div aria-hidden="true" className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -start-10 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative">
        <p className="text-xs font-medium text-muted-foreground">{dayLabel}</p>
        {editing ? (
          <form className="mt-1 flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); saveName(); }}>
            <input autoFocus dir="auto" value={draft} maxLength={40} onChange={(event) => setDraft(event.target.value)}
              placeholder={copy("Your name", "اسمك")} aria-label={copy("Your name", "اسمك")}
              onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }}
              className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 font-serif text-xl outline-none focus:border-primary" />
            <button type="submit" aria-label={copy("Save name", "احفظ الاسم")} className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Check size={17} /></button>
          </form>
        ) : (
          <h2 className="mt-1 font-serif text-[1.75rem] leading-tight sm:text-3xl">
            {greetingFor(now.getHours(), isArabic)}{name ? (isArabic ? `، ${name}` : `, ${name}`) : ""}
            <button type="button" onClick={() => { setDraft(name); setEditing(true); }}
              className="ms-2 align-middle text-xs font-sans font-medium text-primary/80 hover:text-primary hover:underline">
              {name ? copy("edit", "تعديل") : copy("add your name", "أضف اسمك")}
            </button>
          </h2>
        )}

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {data && data.streak > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 font-semibold text-orange-800 dark:bg-orange-950/50 dark:text-orange-200">
              <Flame size={14} />{copy(`${data.streak}-day streak`, `${data.streak} ${data.streak === 1 ? "يوم" : "أيام"} متتالية`)}
            </span>
          )}
          {data && (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 font-medium text-primary">
                <Mic size={13} />{copy(`${data.week.recordings} recording${data.week.recordings === 1 ? "" : "s"} this week`, `${data.week.recordings} تسجيل هذا الأسبوع`)}
                {data.week.minutes > 0 && <span className="opacity-70">· {copy(`${data.week.minutes} min`, `${data.week.minutes} د`)}</span>}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 font-medium text-secondary-foreground">
                <PenLine size={13} />{copy(`${data.week.ideas} written idea${data.week.ideas === 1 ? "" : "s"}`, `${data.week.ideas} فكرة مكتوبة`)}
              </span>
            </>
          )}
        </div>

        {/* The last five weeks: one bar per day, taller and darker on busier days. */}
        <div className="mt-4">
          <div className="flex h-12 items-end gap-[3px]" dir="ltr" role="img"
            aria-label={copy(`Active on ${activeDays} of the last 35 days`, `نشِط في ${activeDays} من آخر 35 يومًا`)}>
            {(days.length ? days : Array.from({ length: 35 }, (_, index) => ({ date: String(index), recordings: 0, ideas: 0 }))).map((day, index, all) => {
              const total = day.recordings + day.ideas;
              const level = total / busiest;
              const today = index === all.length - 1;
              return (
                <span key={day.date}
                  title={days.length ? `${shortDay.format(new Date(`${day.date}T00:00:00Z`))}: ${copy(`${day.recordings} recordings, ${day.ideas} ideas`, `${day.recordings} تسجيل، ${day.ideas} فكرة`)}` : undefined}
                  className={`flex-1 rounded-[3px] transition-all duration-700 ${total ? "bg-primary" : "bg-primary/10"} ${today ? "ring-2 ring-primary/40 ring-offset-1 ring-offset-card" : ""}`}
                  style={{ height: total ? `${30 + level * 70}%` : "18%", opacity: total ? 0.45 + level * 0.55 : 1 }} />
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground" dir="ltr">
            <span>{copy("5 weeks ago", "قبل 5 أسابيع")}</span>
            <span>{copy(`${activeDays} active days`, `${activeDays} يومًا نشطًا`)}</span>
            <span>{copy("Today", "اليوم")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Direction from the text itself (an English idea stays left-to-right on the Arabic screen). */
const dirOf = (text: string | null | undefined) => (text && /[\u0590-\u08FF]/.test(text.slice(0, 40)) ? "rtl" : "ltr");

const relative = (iso: string, language: string) => {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60, "second"], [3600, "minute"], [86400, "hour"], [604800, "day"], [2629800, "week"], [31557600, "month"]];
  for (let i = 0; i < steps.length; i++) {
    const [limit] = steps[i];
    if (Math.abs(seconds) < limit) {
      const divisor = i === 0 ? 1 : steps[i - 1][0];
      return format.format(Math.round(seconds / divisor), steps[i][1]);
    }
  }
  return format.format(Math.round(seconds / 31557600), "year");
};

const hrefFor = (item: { kind: string; id: number; subjectId: number | null }) =>
  item.kind === "recording" ? `/library#item-${item.id}`
    : item.kind === "draft" ? `/subjects/${item.subjectId}#draft-studio`
      : `/subjects/${item.subjectId}#idea-${item.id}`;

/** "Pick up where you left off" and an older idea brought back. */
export function HomeMoments() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [shuffle, setShuffle] = useState(0);
  const { data } = useDashboard(shuffle);
  const { playing, toggle } = usePreview();
  if (!data || (!data.continueWith && !data.resurfaced)) return null;
  const go = () => setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 50);

  const last = data.continueWith;
  const back = data.resurfaced;
  const kindIcon = (kind: string) => (kind === "recording" ? <Mic size={16} /> : kind === "draft" ? <PenLine size={16} /> : <FileText size={16} />);
  const kindLabel = (kind: string) => (kind === "recording" ? copy("Recording", "تسجيل") : kind === "draft" ? copy("Draft", "مسودة") : copy("Idea", "فكرة"));

  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2">
      {last && (
        <article className="flex flex-col rounded-[1.5rem] border bg-card p-5 shadow-sm">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Clock3 size={13} />{copy("Pick up where you left off", "تابع من حيث توقفت")}
          </p>
          <div className="mt-3 flex flex-1 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{kindIcon(last.kind)}</span>
            <div className="min-w-0 flex-1">
              <p dir={dirOf(last.title || copy("Voice note", "ملاحظة صوتية"))} className="line-clamp-2 text-start font-medium leading-6">{last.title || copy("Voice note", "ملاحظة صوتية")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {kindLabel(last.kind)}{last.subjectTitle && last.kind !== "draft" ? <> · <span dir="auto">{last.subjectTitle}</span></> : null} · {relative(last.date, language)}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {last.url && (
              <button type="button" onClick={() => toggle("last", last.url!)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold ${playing === "last" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/15"}`}>
                {playing === "last" ? <Pause size={13} /> : <Play size={13} />}{playing === "last" ? copy("Stop", "إيقاف") : copy("Listen", "استمع")}
              </button>
            )}
            <Link href={hrefFor(last)} onClick={go}
              className="inline-flex h-9 items-center gap-1 rounded-full border px-3.5 text-xs font-medium hover:border-primary/40 hover:text-primary">
              {copy("Continue", "تابع")}<ArrowUpRight size={13} />
            </Link>
          </div>
        </article>
      )}
      {back && (
        <article className="relative flex flex-col overflow-hidden rounded-[1.5rem] border bg-gradient-to-br from-amber-50 via-card to-card p-5 shadow-sm dark:from-amber-950/25">
          <span aria-hidden="true" className="pointer-events-none absolute -end-2 -top-4 font-serif text-[7rem] leading-none text-amber-500/15">“</span>
          <p className="relative flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
            <Sparkles size={13} />{copy(`From ${back.daysAgo} days ago`, `قبل ${back.daysAgo} يومًا`)}
          </p>
          <p dir={dirOf(back.text)} className="relative mt-3 line-clamp-4 flex-1 text-start font-serif text-[17px] italic leading-7">{back.text}</p>
          {back.subjectTitle && <p dir={dirOf(back.subjectTitle)} className="relative mt-2 text-start text-xs text-muted-foreground">{back.kind === "recording" ? "🎙 " : ""}{back.subjectTitle}</p>}
          <div className="relative mt-4 flex flex-wrap gap-2">
            {back.url && (
              <button type="button" onClick={() => toggle("back", back.url!)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold ${playing === "back" ? "bg-amber-600 text-white" : "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200"}`}>
                {playing === "back" ? <Pause size={13} /> : <Play size={13} />}{playing === "back" ? copy("Stop", "إيقاف") : copy("Listen", "استمع")}
              </button>
            )}
            <Link href={hrefFor(back)} onClick={go}
              className="inline-flex h-9 items-center gap-1 rounded-full border bg-card/70 px-3.5 text-xs font-medium hover:border-amber-500/50">
              {copy("Open", "افتح")}<ArrowUpRight size={13} />
            </Link>
            {back.choices > 1 && (
              <button type="button" onClick={() => setShuffle((value) => value + 1)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
                <Shuffle size={13} />{copy("Another", "فكرة أخرى")}
              </button>
            )}
          </div>
        </article>
      )}
    </div>
  );
}

export type { Dashboard };
