import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Feather,
  FileText,
  FlaskConical,
  Inbox,
  LayoutGrid,
  Lightbulb,
  Mic,
  Plus,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";
import {
  getListSubjectsQueryKey,
  useCreateSubject,
  useListSubjects,
} from "@workspace/api-client-react";
import { CreateSubjectForm } from "@/components/create-subject-form";
import {
  CreateIdeaForm,
  type CaptureMode,
} from "@/components/create-idea-form";
import { SubjectList } from "@/components/subject-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

export default function HomePage() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { data: subjects = [], isLoading, error, refetch } = useListSubjects();
  const createSubject = useCreateSubject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [newNotebook, setNewNotebook] = useState(false);
  const [capture, setCapture] = useState<{
    id: number;
    mode: CaptureMode;
  } | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [openingCapture, setOpeningCapture] = useState(false);
  const recent = [...subjects].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  const count = subjects.reduce(
    (total, subject) => total + subject.ideaCount,
    0,
  );
  const captureDisabled =
    openingCapture || createSubject.isPending || isLoading || !!error;

  async function quickCapture(mode: CaptureMode) {
    if (mode === "voice") { navigate("/record"); return; }
    if (captureDisabled) return;
    setOpeningCapture(true);
    try {
      const inbox =
        subjects.find(
          (subject) =>
            subject.title === "Idea inbox" || subject.title === "صندوق الأفكار",
        ) ??
        (await createSubject.mutateAsync({
          data: {
            title: copy("Idea inbox", "صندوق الأفكار"),
            intro: copy(
              "A home for thoughts that don't need a category yet.",
              "مساحة للأفكار التي لم تُصنّف بعد.",
            ),
          },
        }));
      await queryClient.invalidateQueries({
        queryKey: getListSubjectsQueryKey(),
      });
      setCapture({ id: inbox.id, mode });
    } catch {
      toast({
        variant: "destructive",
        title: copy(
          "Couldn't open your inbox. Please try again.",
          "تعذر فتح صندوق الأفكار. حاول مجددًا.",
        ),
      });
    } finally {
      setOpeningCapture(false);
    }
  }

  const outputs = [
    {
      tone: "newspaper_article",
      icon: FileText,
      title: copy("An article", "مقال صحفي"),
      detail: copy("Give your perspective a voice", "امنح وجهة نظرك صوتًا"),
      color: "peach",
    },
    {
      tone: "academic",
      icon: FlaskConical,
      title: copy("A research paper", "ورقة بحثية"),
      detail: copy(
        "Build an argument worth exploring",
        "طوّر فكرة تستحق البحث",
      ),
      color: "sage",
    },
    {
      tone: "youtube_script",
      icon: Video,
      title: copy("A YouTube script", "نص لفيديو يوتيوب"),
      detail: copy("Turn a spark into a story", "حوّل الفكرة إلى قصة"),
      color: "lavender",
    },
    {
      tone: "summary_only",
      icon: AudioLines,
      title: copy("A concise summary", "ملخص موجز"),
      detail: copy(
        "Find the thread in your thoughts",
        "اكتشف الرابط بين أفكارك",
      ),
      color: "sand",
    },
  ];

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link href="/app" className="brand-lockup">
          <span className="brand-mark">
            <Feather size={23} />
          </span>
          <span>
            idea<span className="font-normal">stream</span>
            <small>
              {copy(
                "A little thought. A new possibility.",
                "فكرة صغيرة. احتمالات جديدة.",
              )}
            </small>
          </span>
        </Link>
        <Button
          className="w-full h-11 mt-9 mb-7 rounded-xl"
          onClick={() => quickCapture("text")}
          disabled={captureDisabled}
        >
          <Plus size={17} className="me-2" />
          {copy("Capture an idea", "التقط فكرة")}
        </Button>
        <p className="sidebar-label">
          {copy("YOUR WORKSPACE", "مساحتك الخاصة")}
        </p>
        <nav
          aria-label={copy("Workspace", "مساحة العمل")}
          className="space-y-1"
        >
          <a href="#notebooks" className="sidebar-link active">
            <LayoutGrid size={18} />
            {copy("My notebooks", "دفاتري")}
            <b>{subjects.length}</b>
          </a>
          <button
            className="sidebar-link"
            onClick={() => quickCapture("text")}
            disabled={captureDisabled}
          >
            <Inbox size={18} />
            {copy("Idea inbox", "صندوق الأفكار")}
          </button>
          <a href="#studio" className="sidebar-link">
            <Wand2 size={18} />
            {copy("Creation studio", "استوديو الإبداع")}
          </a>
          <Link href="/record" className="sidebar-link"><Mic size={18} />{copy("Recorder & inbox", "المسجل وصندوق التسجيلات")}</Link>
        </nav>
        <div className="mt-10 flex justify-between items-center">
          <p className="sidebar-label mb-0">
            {copy("RECENT NOTEBOOKS", "الدفاتر الأخيرة")}
          </p>
          <button
            onClick={() => setNewNotebook(true)}
            aria-label={copy("New notebook", "دفتر جديد")}
            className="p-2 rounded-lg hover:bg-secondary"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="mt-3 space-y-1">
          {recent.slice(0, 5).map((subject, index) => (
            <Link
              key={subject.id}
              href={`/subjects/${subject.id}`}
              className="sidebar-link text-sm"
            >
              <span className={`notebook-dot dot-${index % 4}`} />
              <span className="truncate">{subject.title}</span>
            </Link>
          ))}
          {!recent.length && (
            <p className="text-xs text-muted-foreground leading-6 px-3">
              {copy(
                "Your next big thing starts with one small note.",
                "مشروعك القادم يبدأ بملاحظة صغيرة.",
              )}
            </p>
          )}
        </div>
        <div className="sidebar-note">
          <Lightbulb size={21} />
          <p>{copy("Let your ideas breathe.", "امنح أفكارك مساحة.")}</p>
          <small>
            {copy(
              "Capture now. Connect the dots later.",
              "التقطها الآن. واربطها لاحقًا.",
            )}
          </small>
          <div className="note-doodle" aria-hidden="true">
            ✧
          </div>
        </div>
        <div className="sidebar-footer">
          <span className="h-8 w-8 rounded-full bg-secondary grid place-items-center">
            <Feather size={15} />
          </span>
          <div>
            {copy("Your creative space", "مساحتك الإبداعية")}
            <small>{copy("Made for curious minds", "للعقول الفضولية")}</small>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="flex items-center gap-2">
            <BookOpen size={16} />
            <span>{copy("My workspace", "مساحة العمل")}</span>
            <span className="mx-2 text-border">/</span>
            <span className="text-foreground">
              {copy("Notebooks", "الدفاتر")}
            </span>
          </div>
          <span className="hidden md:block text-xs pe-28">
            {new Intl.DateTimeFormat(language, {
              month: "long",
              day: "numeric",
              year: "numeric",
            }).format(new Date())}
          </span>
        </header>
        <main id="main-content" className="workspace-content">
          <section className="workspace-welcome">
            <div>
              <p className="eyebrow">
                <span />
                {copy("A SPACE FOR WHAT'S NEXT", "مساحة لما هو قادم")}
              </p>
              <h1>
                {copy("Big things start", "الأشياء العظيمة تبدأ")}
                <br />
                {copy("with a ", "بـ")}
                <em>{copy("little idea.", "فكرة صغيرة.")}</em>
              </h1>
              <p className="welcome-description">
                {copy(
                  "The passing thought. The voice note. The video that stays with you.\nBring them together, and make something that matters.",
                  "خاطرة عابرة. ملاحظة صوتية. فيديو ألهمك.\nاجمعها معًا، واصنع منها شيئًا يستحق.",
                )}
              </p>
            </div>
            <div className="idea-illustration" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <span className="floating-spark">✧</span>
              <div className="paper paper-back">
                <AudioLines size={28} />
                <span />
                <span />
              </div>
              <div className="paper paper-front">
                <Lightbulb size={27} />
                <i />
                <span />
                <span />
                <span />
                <small>one little idea</small>
              </div>
              <div className="illustration-badge">
                <Sparkles size={17} />
                {copy("Endless possibilities", "احتمالات بلا حدود")}
              </div>
            </div>
          </section>
          <section
            aria-label={copy("Quick capture", "التقاط سريع")}
            className="capture-bar"
          >
            <div className="capture-intro">
              <span className="capture-icon">
                <Plus size={20} />
              </span>
              <div>
                <strong>
                  {copy("What's on your mind?", "ما الذي يدور في ذهنك؟")}
                </strong>
                <p>
                  {copy(
                    "Catch it before it slips away.",
                    "التقط فكرتك قبل أن تضيع.",
                  )}
                </p>
              </div>
            </div>
            <div className="capture-actions">
              {(
                [
                  ["text", Feather, copy("Write a note", "اكتب ملاحظة")],
                  ["voice", Mic, copy("Record a thought", "سجّل فكرة")],
                  [
                    "link",
                    Video,
                    copy("Add a video or link", "أضف فيديو أو رابطًا"),
                  ],
                ] as const
              ).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  onClick={() => quickCapture(mode)}
                  disabled={mode !== "voice" && captureDisabled}
                  className={`capture-action capture-${mode}`}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </section>
          <section id="notebooks" className="scroll-mt-6 mt-11">
            <div className="section-heading">
              <div>
                <div className="flex gap-3 items-center">
                  <h2>{copy("Your notebooks", "دفاترك")}</h2>
                  <span className="count-pill">{subjects.length}</span>
                </div>
                <p>
                  {copy(
                    "A home for every idea, and room for it to grow.",
                    "بيت لكل فكرة، ومساحة لتنمو.",
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                className="bg-card rounded-lg"
                onClick={() => setNewNotebook(true)}
              >
                <Plus size={16} className="me-2" />
                {copy("New notebook", "دفتر جديد")}
              </Button>
            </div>
            {isLoading ? (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-52 rounded-xl" />
                ))}
              </div>
            ) : error ? (
              <div role="alert" className="rounded-xl border p-8 bg-card">
                <p>
                  {copy(
                    "Your notebooks couldn't be loaded. Please check your connection.",
                    "تعذر تحميل دفاترك. تحقق من الاتصال.",
                  )}
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => refetch()}
                >
                  {copy("Try again", "حاول مجددًا")}
                </Button>
              </div>
            ) : (
              <SubjectList
                subjects={subjects}
                onCreate={() => setNewNotebook(true)}
              />
            )}
            {count > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                {copy(
                  `${count} ideas collected. Every one is a beginning.`,
                  `${count} فكرة محفوظة. كل واحدة منها بداية.`,
                )}
              </p>
            )}
          </section>
          <section id="studio" className="studio-section scroll-mt-6">
            <div className="section-heading">
              <div>
                <p className="eyebrow mb-2">
                  <Sparkles size={13} />
                  {copy(
                    "FROM THOUGHT TO SOMETHING REAL",
                    "من فكرة إلى شيء ملموس",
                  )}
                </p>
                <h2>{copy("What will you create?", "ماذا ستبدع؟")}</h2>
                <p>
                  {copy(
                    "Choose a format. Your collected ideas become the starting point.",
                    "اختر قالبًا. أفكارك المتراكمة هي نقطة البداية.",
                  )}
                </p>
              </div>
            </div>
            <div className="output-grid">
              {outputs.map(({ tone, icon: Icon, title, detail, color }) => (
                <button
                  key={tone}
                  onClick={() => setOutput(tone)}
                  className="output-card group"
                >
                  <div className={`output-icon ${color}`}>
                    <Icon size={21} />
                  </div>
                  <ArrowUpRight
                    size={16}
                    className="absolute end-4 top-5 text-muted-foreground group-hover:text-primary"
                  />
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </button>
              ))}
            </div>
          </section>
          <footer className="workspace-bottom">
            <span>ideastream</span>
            <p>
              {copy(
                "A thought today. Something extraordinary tomorrow.",
                "فكرة اليوم. شيء استثنائي غدًا.",
              )}
            </p>
            <Feather size={15} />
          </footer>
        </main>
      </div>
      <Dialog open={newNotebook} onOpenChange={setNewNotebook}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {copy("Start a new notebook", "ابدأ دفترًا جديدًا")}
            </DialogTitle>
            <DialogDescription>
              {copy(
                "Give your ideas a home. A topic, a question, or a project is a good place to start.",
                "امنح أفكارك بيتًا. ابدأ بموضوع أو سؤال أو مشروع.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-5">
            <CreateSubjectForm />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!capture}
        onOpenChange={(open) => !open && !captureBusy && setCapture(null)}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {copy("Catch a little idea", "التقط فكرة صغيرة")}
            </DialogTitle>
            <DialogDescription>
              {copy(
                "Saved ideas go to your Idea inbox. You can develop them whenever you're ready.",
                "تُحفظ الأفكار في صندوق الأفكار، ويمكنك تطويرها عندما تكون مستعدًا.",
              )}
            </DialogDescription>
          </DialogHeader>
          {capture && (
            <CreateIdeaForm
              key={capture.id}
              subjectId={capture.id}
              initialMode={capture.mode}
              onBusyChange={setCaptureBusy}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!output} onOpenChange={(open) => !open && setOutput(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {copy("Choose your starting point", "اختر نقطة البداية")}
            </DialogTitle>
            <DialogDescription>
              {copy(
                "Which notebook would you like to turn into a draft?",
                "أي دفتر تريد تحويله إلى مسودة؟",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {recent
              .filter((s) => s.ideaCount > 0)
              .map((s) => (
                <button
                  key={s.id}
                  className="w-full flex justify-between gap-4 rounded-xl border p-4 text-start hover:bg-secondary"
                  onClick={() =>
                    navigate(`/subjects/${s.id}?output=${output}#draft-studio`)
                  }
                >
                  <span>{s.title}</span>
                  <ArrowUpRight className="shrink-0" size={17} />
                </button>
              ))}
            {!recent.some((s) => s.ideaCount > 0) && (
              <p className="p-5 text-muted-foreground">
                {copy(
                  "Capture your first idea in a notebook, then come back to shape it into a draft.",
                  "احفظ فكرتك الأولى في دفتر، ثم عد لصياغتها في مسودة.",
                )}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
