import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Loader2,
  Mic,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import {
  addAudioLibraryItemToSubject,
  buildEpisode,
  compileSubject,
  getListAudioLibraryQueryKey,
  getListSubjectCompilationsQueryKey,
  mixAudioLibraryItem,
  requestUploadUrl,
  useGetSubject,
  useListAudioLibrary,
  useListSubjectCompilations,
  type AudioLibraryItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { appPath, uploadCredentials } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { DEFAULT_MIX, presetSettings } from "@/lib/mix";
import { followPosition, isArabicScript, readingSeconds, scriptSections, scriptWords, spoken, type Section } from "@/lib/teleprompter";

type Step = "script" | "record" | "build" | "done";
type Take = { blob: Blob; url: string; seconds: number };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const TONES = { youtube_script: ["YouTube video script", "نص فيديو يوتيوب"], broadcast_script: ["Podcast / broadcast script", "نص بودكاست أو بث"] } as const;

type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
};

export default function EpisodeStudio() {
  const { id } = useParams<{ id: string }>();
  const subjectId = Number(id);
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: subject } = useGetSubject(subjectId);
  const { data: drafts = [] } = useListSubjectCompilations(subjectId);
  const { data: library = [] } = useListAudioLibrary();
  const music = library.filter((item) => item.kind === "music");

  const [step, setStep] = useState<Step>("script");
  const [script, setScript] = useState("");
  const [own, setOwn] = useState("");
  const [writing, setWriting] = useState<string | null>(null);
  const sections = useMemo<Section[]>(() => (script ? scriptSections(script) : []), [script]);
  const [current, setCurrent] = useState(0);
  const [takes, setTakes] = useState<Record<number, Take>>({});
  const [title, setTitle] = useState("");
  const [clean, setClean] = useState(true);
  const [tighten, setTighten] = useState(true);
  const [musicId, setMusicId] = useState<number | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const [episode, setEpisode] = useState<AudioLibraryItem | null>(null);

  useEffect(() => { if (subject && !title) setTitle(subject.title); }, [subject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recorded sections live only in this page until the episode is made: warn before leaving.
  const unsaved = Object.keys(takes).length > 0 && step !== "done";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  async function writeScript(tone: keyof typeof TONES) {
    setWriting(tone);
    try {
      const draft = await compileSubject(subjectId, { tone });
      await queryClient.invalidateQueries({ queryKey: getListSubjectCompilationsQueryKey(subjectId) });
      chooseScript(draft.content);
    } catch (error) {
      toast({ variant: "destructive", title: (error as { data?: { error?: string } })?.data?.error ?? copy("Couldn't write the script.", "تعذرت كتابة النص.") });
    } finally { setWriting(null); }
  }

  function chooseScript(text: string) {
    setScript(text);
    setTakes({});
    setCurrent(0);
    setStep("record");
  }

  async function makeEpisode() {
    const ordered = sections.map((section, index) => ({ section, take: takes[index] })).filter((entry) => entry.take);
    if (!ordered.length) return;
    try {
      const uploaded: Array<{ title: string; url: string }> = [];
      for (const [index, { section, take }] of ordered.entries()) {
        setBuilding(copy(`Uploading section ${index + 1} of ${ordered.length}…`, `جارٍ رفع المقطع ${index + 1} من ${ordered.length}…`));
        const type = take.blob.type || "audio/webm";
        const upload = await requestUploadUrl({ name: `episode-${Date.now()}-${index}.webm`, size: take.blob.size, contentType: type });
        const response = await fetch(appPath(upload.uploadURL, import.meta.env.BASE_URL), {
          method: "PUT", body: take.blob, headers: { "Content-Type": type },
          credentials: uploadCredentials(upload.uploadURL, location.origin),
        });
        if (!response.ok) throw new Error("upload");
        uploaded.push({ title: section.title, url: `/api/storage${upload.objectPath}` });
      }
      setBuilding(clean ? copy("Polishing your voice and joining the sections…", "جارٍ تحسين صوتك وضم المقاطع…") : copy("Joining the sections…", "جارٍ ضم المقاطع…"));
      let item = await buildEpisode({ title: title.trim() || subject?.title || "Episode", sections: uploaded, clean, tighten, script: sections.map((section) => spoken(section.text)).join("\n\n") });
      if (musicId) {
        setBuilding(copy("Adding the music…", "جارٍ إضافة الموسيقى…"));
        const settings = presetSettings("introOutro", item.durationSeconds ?? 60, DEFAULT_MIX);
        item = await mixAudioLibraryItem(item.id, { musicItemId: musicId, settings, target: "same" });
      }
      setBuilding(copy("Filing it in this notebook…", "جارٍ حفظه في هذا الدفتر…"));
      item = await addAudioLibraryItemToSubject(item.id, { subjectId }).catch(() => item);
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      setEpisode(item);
      setStep("done");
      Object.values(takes).forEach((take) => URL.revokeObjectURL(take.url));
    } catch (error) {
      toast({ variant: "destructive", title: copy("The episode couldn't be made", "تعذر صنع الحلقة"),
        description: (error as { data?: { error?: string } })?.data?.error ?? copy("Your recorded sections are still here. Please try again.", "مقاطعك المسجلة ما زالت هنا. حاول مجددًا.") });
    } finally { setBuilding(null); }
  }

  const recorded = Object.keys(takes).length;
  const steps: Array<[Step, string]> = [["script", copy("Script", "النص")], ["record", copy("Record", "التسجيل")], ["build", copy("Polish", "التحسين")], ["done", copy("Episode", "الحلقة")]];

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6">
      <Link href={`/subjects/${subjectId}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={15} className="rtl:rotate-180" />{subject?.title ?? copy("Notebook", "الدفتر")}
      </Link>
      <h1 className="font-serif text-3xl">{copy("Episode studio", "استوديو الحلقات")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{copy("From this notebook to a finished episode: script, teleprompter, polish.", "من هذا الدفتر إلى حلقة جاهزة: نص، ملقّن، تحسين.")}</p>

      <ol className="mt-5 grid grid-cols-4 gap-1.5 text-[11px] font-semibold" aria-label={copy("Steps", "الخطوات")}>
        {steps.map(([id, label], index) => {
          const reached = steps.findIndex(([s]) => s === step) >= index;
          return (
            <li key={id} aria-current={step === id ? "step" : undefined}
              className={`rounded-full px-2 py-1.5 text-center ${step === id ? "bg-primary text-primary-foreground" : reached ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
              {index + 1}. {label}
            </li>
          );
        })}
      </ol>

      {step === "script" && (
        <section className="mt-6 space-y-5" aria-label={copy("Choose a script", "اختر نصًا")}>
          <div>
            <h2 className="text-sm font-semibold">{copy("Write a new script from this notebook", "اكتب نصًا جديدًا من هذا الدفتر")}</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(Object.keys(TONES) as Array<keyof typeof TONES>).map((tone) => (
                <button key={tone} type="button" disabled={!!writing} onClick={() => void writeScript(tone)}
                  className="flex items-center gap-3 rounded-2xl border bg-card p-4 text-start transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{writing === tone ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}</span>
                  <span className="text-sm font-medium">{isArabic ? TONES[tone][1] : TONES[tone][0]}</span>
                </button>
              ))}
            </div>
            {writing && <p className="mt-2 text-xs text-muted-foreground" role="status">{copy("Writing from your ideas… this takes about half a minute.", "جارٍ الكتابة من أفكارك… يستغرق ذلك نصف دقيقة تقريبًا.")}</p>}
          </div>
          {drafts.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold">{copy("Or read one of your drafts", "أو اقرأ إحدى مسوداتك")}</h2>
              <ul className="mt-2 space-y-2">
                {drafts.slice(0, 6).map((draft) => {
                  const preview = scriptSections(draft.content);
                  return (
                    <li key={draft.id}>
                      <button type="button" onClick={() => chooseScript(draft.content)}
                        className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-start transition hover:border-primary/40 hover:bg-primary/5">
                        <FileText size={18} className="shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span dir="auto" className="line-clamp-1 block text-sm font-medium">{preview[0]?.title ?? draft.tone}</span>
                          <span className="block text-xs text-muted-foreground">
                            {draft.tone.replace(/_/g, " ")} · {copy(`${preview.length} sections`, `${preview.length} مقاطع`)} · ~{clock(preview.reduce((sum, section) => sum + readingSeconds(section.text), 0))}
                          </span>
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-muted-foreground rtl:rotate-180" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div>
            <h2 className="text-sm font-semibold">{copy("Or paste your own", "أو الصق نصك")}</h2>
            <textarea value={own} onChange={(event) => setOwn(event.target.value)} rows={5} dir="auto"
              placeholder={copy("# Opening\nWhat you'll say first…\n\n# Main part\n…", "# المقدمة\nما ستقوله أولًا…\n\n# الجزء الرئيسي\n…")}
              className="mt-2 w-full rounded-2xl border bg-card p-3 text-sm outline-none focus:border-primary" />
            <Button className="mt-2 rounded-full" disabled={!own.trim()} onClick={() => chooseScript(own)}>{copy("Use this script", "استخدم هذا النص")}</Button>
          </div>
        </section>
      )}

      {step === "record" && sections.length > 0 && (
        <section className="mt-6" aria-label={copy("Record", "التسجيل")}>
          <div className="flex gap-1.5 overflow-x-auto pb-2" role="tablist" aria-label={copy("Sections", "المقاطع")}>
            {sections.map((section, index) => (
              <button key={index} type="button" role="tab" aria-selected={current === index} onClick={() => setCurrent(index)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${current === index ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground"}`}>
                {takes[index] ? <Check size={12} className="text-primary" /> : <span className="tabular-nums">{index + 1}</span>}
                <span dir="auto" className="max-w-[9rem] truncate">{section.title}</span>
              </button>
            ))}
          </div>
          <Teleprompter
            key={current}
            section={sections[current]}
            index={current}
            count={sections.length}
            take={takes[current] ?? null}
            copy={copy}
            onTake={(take) => setTakes((all) => { if (all[current]) URL.revokeObjectURL(all[current].url); return { ...all, [current]: take }; })}
            onNext={() => (current < sections.length - 1 ? setCurrent(current + 1) : setStep("build"))}
            onPrevious={() => setCurrent(Math.max(0, current - 1))}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" onClick={() => setStep("script")} className="text-muted-foreground hover:text-foreground">{copy("← Choose another script", "← اختر نصًا آخر")}</button>
            <Button className="rounded-full" disabled={!recorded} onClick={() => setStep("build")}>
              {copy(`Next: polish (${recorded}/${sections.length} recorded)`, `التالي: التحسين (${recorded}/${sections.length})`)}
            </Button>
          </div>
        </section>
      )}

      {step === "build" && (
        <section className="mt-6 space-y-4" aria-label={copy("Polish", "التحسين")}>
          <label className="block">
            <span className="text-sm font-semibold">{copy("Episode title", "عنوان الحلقة")}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} dir="auto"
              className="mt-1.5 h-11 w-full rounded-xl border bg-card px-3 text-[15px] outline-none focus:border-primary" />
          </label>
          <div className="space-y-2 rounded-2xl border bg-card p-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={clean} onChange={(event) => setClean(event.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" />
              <span><span className="block text-sm font-medium">{copy("Clean up my voice", "حسّن صوتي")}</span>
                <span className="block text-xs text-muted-foreground">{copy("Less background noise and rumble, clearer speech, even podcast loudness.", "ضوضاء خلفية أقل، كلام أوضح، وارتفاع صوت متوازن مثل البودكاست.")}</span></span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={tighten} onChange={(event) => setTighten(event.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" />
              <span><span className="block text-sm font-medium">{copy("Tighten long pauses", "اختصر الوقفات الطويلة")}</span>
                <span className="block text-xs text-muted-foreground">{copy("Silences at the start and end are trimmed; pauses over 0.7 s are shortened.", "يُقص الصمت في البداية والنهاية، وتُختصر الوقفات الأطول من 0.7 ث.")}</span></span>
            </label>
            <label className="flex items-start gap-3">
              <span className="mt-0.5 text-sm">🎵</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{copy("Intro & outro music", "موسيقى للبداية والنهاية")}</span>
                <select value={musicId ?? ""} onChange={(event) => setMusicId(event.target.value ? Number(event.target.value) : null)}
                  className="mt-1.5 h-9 w-full rounded-lg border bg-background px-2 text-sm">
                  <option value="">{copy("No music", "بلا موسيقى")}</option>
                  {music.map((item) => <option key={item.id} value={item.id}>{item.title ?? copy("Music", "موسيقى")}</option>)}
                </select>
                {!music.length && <span className="mt-1 block text-xs text-muted-foreground">{copy("Upload a song in the audio library (Add music) to use it here.", "ارفع مقطوعة في مكتبة الصوت (أضف موسيقى) لتستخدمها هنا.")}</span>}
              </span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {copy(`${recorded} of ${sections.length} sections recorded. Sections without a take are left out.`, `سُجّل ${recorded} من ${sections.length} مقاطع. المقاطع غير المسجلة تُترك.`)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="rounded-full" disabled={!!building} onClick={() => setStep("record")}>{copy("Back to recording", "عودة للتسجيل")}</Button>
            <Button className="rounded-full" disabled={!!building || !recorded} onClick={() => void makeEpisode()}>
              {building ? <Loader2 size={15} className="me-1.5 animate-spin" /> : <Wand2 size={15} className="me-1.5" />}{copy("Make my episode", "اصنع حلقتي")}
            </Button>
          </div>
          {building && <p className="text-sm text-primary" role="status">{building}</p>}
        </section>
      )}

      {step === "done" && episode && <EpisodeDone episode={episode} copy={copy} />}
    </main>
  );
}

/** The script on screen, large, moving with your voice; record, listen, retake. */
function Teleprompter({ section, index, count, take, copy, onTake, onNext, onPrevious }: {
  section: Section; index: number; count: number; take: Take | null; copy: (en: string, ar: string) => string;
  onTake: (take: Take) => void; onNext: () => void; onPrevious: () => void;
}) {
  const words = useMemo(() => spoken(section.text).split(/\s+/).filter(Boolean), [section.text]);
  const folded = useMemo(() => scriptWords(section.text), [section.text]);
  const arabic = isArabicScript(section.text);
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem("idea-stream-prompter-size")) || 28; } catch { return 28; } });
  const [state, setState] = useState<"idle" | "countdown" | "recording">("idle");
  const [count3, setCount3] = useState(3);
  const [position, setPosition] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const speechAvailable = typeof window !== "undefined" && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  // On phones the microphone can't always be shared with speech recognition: follow by voice level there.
  const [followVoice, setFollowVoice] = useState(speechAvailable && !coarse);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ stream: MediaStream; recorder: MediaRecorder; context: AudioContext; analyser: AnalyserNode; chunks: Blob[]; started: number; timer: number; recognition: SpeechRecognitionLike | null } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const positionRef = useRef(0);
  positionRef.current = position;

  useEffect(() => { try { localStorage.setItem("idea-stream-prompter-size", String(size)); } catch { /* optional */ } }, [size]);
  useEffect(() => () => { stopAll(); audio.current?.pause(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the current word about a third from the top.
  useEffect(() => {
    const element = box.current?.querySelector<HTMLElement>(`[data-w="${Math.min(position, words.length - 1)}"]`);
    if (element && box.current) box.current.scrollTo({ top: Math.max(0, element.offsetTop - box.current.clientHeight / 3), behavior: "smooth" });
  }, [position, words.length]);

  const stopAll = useCallback(() => {
    const session = live.current;
    if (!session) return;
    window.clearInterval(session.timer);
    try { session.recognition?.stop(); } catch { /* already stopped */ }
    session.recognition = null;
    if (session.recorder.state !== "inactive") session.recorder.stop();
    session.stream.getTracks().forEach((track) => track.stop());
    void session.context.close().catch(() => {});
  }, []);

  async function start() {
    audio.current?.pause();
    setPlaying(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      alert(copy("The microphone isn't available. Allow microphone access and try again.", "الميكروفون غير متاح. اسمح بالوصول إليه وحاول مجددًا."));
      return;
    }
    setPosition(0);
    setState("countdown");
    for (let n = 3; n >= 1; n--) { setCount3(n); await new Promise((resolve) => setTimeout(resolve, 700)); }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported?.(candidate)) ?? "";
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const length = (Date.now() - started) / 1000;
      if (blob.size > 0 && length > 0.8) onTake({ blob, url: URL.createObjectURL(blob), seconds: length });
      setState("idle");
      setLevel(0);
    };
    const started = Date.now();
    recorder.start(1000);
    navigator.vibrate?.(20);
    const samples = new Uint8Array(analyser.fftSize);
    let speaking = 0;
    // When speech recognition last placed you in the script.
    let lastHeard = 0;
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += ((value - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      setLevel(Math.min(1, rms * 4));
      setSeconds((Date.now() - started) / 1000);
      // Without speech recognition (or when it hears nothing for 1.5 s): move on at a reading
      // pace, only while you're speaking.
      if (!live.current?.recognition || Date.now() - Math.max(lastHeard, started) > 1500) {
        speaking = rms > 0.02 ? speaking + 0.1 : 0;
        if (speaking > 0) setPosition((value) => Math.min(words.length, value + (140 / 60) * 0.1));
      }
    }, 100);
    let recognition: SpeechRecognitionLike | null = null;
    if (followVoice) {
      const Recognition = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
        ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
      if (Recognition) {
        recognition = new Recognition();
        recognition.lang = arabic ? "ar-SA" : "en-US";
        recognition.continuous = true;
        recognition.interimResults = true;
        let heard = "";
        recognition.onresult = (event) => {
          let text = "";
          for (let i = 0; i < event.results.length; i++) text += ` ${event.results[i][0].transcript}`;
          heard = text;
          lastHeard = Date.now();
          setPosition((value) => followPosition(folded, heard, Math.floor(value)));
        };
        // Recognition stops by itself after silences; keep it going while recording.
        recognition.onend = () => { if (live.current?.recorder.state === "recording" && live.current.recognition) { try { live.current.recognition.start(); } catch { /* ignore */ } } };
        recognition.onerror = () => { /* falls back to the reading pace */ };
        try { recognition.start(); } catch { recognition = null; }
      }
    }
    live.current = { stream, recorder, context, analyser, chunks, started, timer, recognition };
    setState("recording");
  }

  function stop() {
    stopAll();
    live.current = null;
    navigator.vibrate?.([15, 50, 15]);
  }

  function listen() {
    if (!take) return;
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    const element = audio.current ?? (audio.current = new Audio());
    element.src = take.url;
    element.onended = () => setPlaying(false);
    void element.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  const at = Math.floor(position);
  return (
    <div className="mt-2 overflow-hidden rounded-[1.5rem] border bg-ink text-ink-foreground shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5 text-xs">
        <span className="font-semibold text-white/80">{copy(`Section ${index + 1} of ${count}`, `المقطع ${index + 1} من ${count}`)} · <span dir="auto">{section.title}</span></span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setSize((value) => Math.max(18, value - 3))} aria-label={copy("Smaller text", "نص أصغر")} className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/10"><Minus size={13} /></button>
          <button type="button" onClick={() => setSize((value) => Math.min(48, value + 3))} aria-label={copy("Larger text", "نص أكبر")} className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/10"><Plus size={13} /></button>
        </span>
      </div>
      <div ref={box} dir={arabic ? "rtl" : "ltr"} className="relative h-[46vh] overflow-y-auto px-5 py-[16vh] leading-[1.55]" style={{ fontSize: size }} aria-live="off">
        {state === "countdown" && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-ink/80 text-7xl font-light" role="status">{count3}</div>
        )}
        <p className="text-start">
          {words.map((word, i) => (
            <span key={i} data-w={i} className={`transition-colors duration-200 ${i < at ? "text-white/30" : i === at && state === "recording" ? "rounded bg-emerald-400/25 text-white" : "text-white/90"}`}>
              {word}{" "}
            </span>
          ))}
        </p>
        {/[[]/.test(section.text) && (
          <p className="mt-6 text-[0.55em] text-amber-200/70">{(section.text.match(/\[[^\]]*\]/g) ?? []).join(" ")}</p>
        )}
      </div>
      <div className="border-t border-white/10 px-4 py-3">
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-100" style={{ width: `${state === "recording" ? Math.max(4, level * 100) : 0}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onPrevious} disabled={index === 0 || state !== "idle"} aria-label={copy("Previous section", "المقطع السابق")}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 disabled:opacity-30"><ChevronLeft size={18} className="rtl:rotate-180" /></button>
          {state === "recording" ? (
            <button type="button" onClick={stop} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-red-600 px-5 font-semibold text-white">
              <Square size={16} fill="currentColor" />{copy("Stop", "إيقاف")} · <span className="tabular-nums">{clock(seconds)}</span>
            </button>
          ) : (
            <button type="button" onClick={() => void start()} disabled={state === "countdown"}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-rose-400 via-red-500 to-red-700 px-5 font-semibold text-white shadow-lg disabled:opacity-60">
              {take ? <RotateCcw size={17} /> : <Mic size={18} />}{take ? copy("Retake", "أعد التسجيل") : copy("Record this section", "سجّل هذا المقطع")}
            </button>
          )}
          {take && state === "idle" && (
            <button type="button" onClick={listen} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-sm">
              {playing ? <Pause size={14} /> : <Play size={14} />}{clock(take.seconds)}
            </button>
          )}
          <button type="button" onClick={onNext} disabled={state !== "idle"} aria-label={copy("Next section", "المقطع التالي")}
            className={`grid h-10 w-10 place-items-center rounded-full disabled:opacity-30 ${take ? "bg-emerald-500 text-[#06150e]" : "bg-white/10"}`}><ChevronRight size={18} className="rtl:rotate-180" /></button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" checked={followVoice} disabled={!speechAvailable || state !== "idle"} onChange={(event) => setFollowVoice(event.target.checked)} className="h-3.5 w-3.5" />
          {speechAvailable
            ? copy("Follow my voice word by word (otherwise it scrolls at reading pace while you speak)", "تتبّع صوتي كلمة بكلمة (وإلا يتحرك بسرعة القراءة أثناء كلامك)")
            : copy("Scrolls at reading pace while you speak", "يتحرك بسرعة القراءة أثناء كلامك")}
        </label>
      </div>
    </div>
  );
}

function EpisodeDone({ episode, copy }: { episode: AudioLibraryItem; copy: (en: string, ar: string) => string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [copied, setCopied] = useState(false);
  const notes = [episode.summary, ...(episode.chapters ?? []).map((chapter) => `${clock(chapter.start)} ${chapter.title}`)].filter(Boolean).join("\n");
  return (
    <section className="mt-6 space-y-4" aria-label={copy("Your episode", "حلقتك")}>
      <div className="rounded-[1.5rem] border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"><Check size={14} />{copy("Your episode is ready", "حلقتك جاهزة")}</p>
        <h2 dir="auto" className="mt-2 font-serif text-2xl">{episode.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{clock(episode.durationSeconds ?? 0)}{episode.mix ? ` · 🎵 ${episode.mix.musicTitle ?? ""}` : ""}</p>
        <audio ref={audio} controls src={appPath(episode.url, import.meta.env.BASE_URL)} className="mt-4 w-full" />
        {episode.summary && <p dir="auto" className="mt-4 text-sm leading-6 text-foreground/85">{episode.summary}</p>}
        {episode.chapters && episode.chapters.length > 1 && (
          <ol className="mt-4 space-y-1">
            {episode.chapters.map((chapter) => (
              <li key={chapter.start}>
                <button type="button" onClick={() => { if (audio.current) { audio.current.currentTime = chapter.start; void audio.current.play(); } }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-primary/5">
                  <span className="font-mono text-xs tabular-nums text-primary">{clock(chapter.start)}</span><span dir="auto">{chapter.title}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={appPath(`/api/audio-library/${episode.id}/export?format=mp3&quality=high`, import.meta.env.BASE_URL)}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"><Download size={15} />{copy("Download MP3", "تنزيل MP3")}</a>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(notes).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          className="inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? copy("Copied", "نُسخت") : copy("Copy show notes", "انسخ ملاحظات الحلقة")}</button>
        <Link href={`/library#item-${episode.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium">{copy("Open in library", "افتح في المكتبة")}</Link>
      </div>
      <p className="text-xs text-muted-foreground">{copy("It's saved in your audio library and in this notebook. Edit it, change the music or convert it to text there anytime.", "حُفظت في مكتبة الصوت وفي هذا الدفتر. يمكنك تحريرها أو تغيير الموسيقى أو تحويلها إلى نص من هناك في أي وقت.")}</p>
    </section>
  );
}
