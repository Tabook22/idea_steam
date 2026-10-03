import { useEffect, useRef, type ReactNode } from "react";
import { BookOpen, X } from "lucide-react";

export type HelpTopic = "start" | "picture" | "sounds" | "lane" | "numbers" | "boxes" | "noise" | "bands" | "volume" | "listen" | "recipes" | "tips";

/* ---------- Example pictures: what each kind of sound looks like ---------- */

type ExampleKind = "voice" | "consonants" | "rumble" | "hum" | "hiss" | "music" | "click" | "silence";

// The same colours as the real picture: dark = quiet, orange/yellow = loud.
const HOT = "#fcd34d";
const WARM = "#f97316";
const MID = "#a8326e";
const DIM = "#4c1d6b";

/** Tiny stand-ins for patterns in the real spectrogram (time across, pitch up). */
function MiniPicture({ kind, label }: { kind: ExampleKind; label: string }) {
  const shapes: ReactNode[] = [];
  // Deterministic speckle so the pictures never change between visits.
  let seed = kind.length * 97;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  if (kind === "voice" || kind === "consonants") {
    // Syllables: stacks of gently curving harmonics, strongest at the bottom.
    [6, 34, 62, 90].forEach((x, s) => {
      for (let h = 0; h < 6; h++) {
        const y = 54 - h * 6 - (s % 2) * 2;
        shapes.push(<path key={`v${s}${h}`} d={`M${x} ${y} q 9 ${-3 + s} 20 ${s % 2 ? 2 : -2}`} stroke={h < 2 ? HOT : h < 4 ? WARM : MID} strokeWidth={h < 2 ? 2.4 : 1.6} fill="none" opacity={1 - h * 0.1} />);
      }
    });
    if (kind === "consonants") [28, 57, 85, 113].forEach((x, i) => shapes.push(<rect key={`c${i}`} x={x} y={4} width={2.5} height={34} fill={i % 2 ? WARM : MID} opacity={0.9} />));
  }
  if (kind === "rumble") {
    shapes.push(<rect key="r1" x={0} y={48} width={120} height={12} fill={WARM} opacity={0.9} />);
    shapes.push(<rect key="r2" x={0} y={42} width={120} height={6} fill={MID} opacity={0.7} />);
    for (let i = 0; i < 40; i++) shapes.push(<rect key={`rs${i}`} x={rand() * 120} y={44 + rand() * 14} width={2} height={2} fill={HOT} opacity={0.6} />);
  }
  if (kind === "hum") {
    shapes.push(<rect key="h1" x={0} y={53} width={120} height={2} fill={HOT} />);
    shapes.push(<rect key="h2" x={0} y={47} width={120} height={1.5} fill={WARM} opacity={0.85} />);
    shapes.push(<rect key="h3" x={0} y={42} width={120} height={1.2} fill={MID} opacity={0.8} />);
  }
  if (kind === "hiss") {
    for (let i = 0; i < 260; i++) shapes.push(<rect key={`s${i}`} x={rand() * 120} y={rand() * 34} width={1.6} height={1.6} fill={rand() > 0.85 ? MID : DIM} />);
  }
  if (kind === "music") {
    // Held notes: long, perfectly straight lines that change in steps.
    [[0, 40, [50, 41, 34]], [40, 80, [47, 38, 30]], [80, 120, [52, 44, 36]]].forEach(([from, to, ys], n) => {
      (ys as number[]).forEach((y, i) => shapes.push(<rect key={`m${n}${i}`} x={(from as number) + 1} y={y} width={(to as number) - (from as number) - 2} height={2} fill={i === 0 ? HOT : i === 1 ? WARM : MID} />));
    });
  }
  if (kind === "click") {
    for (let i = 0; i < 60; i++) shapes.push(<rect key={`k${i}`} x={rand() * 120} y={rand() * 60} width={1.4} height={1.4} fill={DIM} />);
    shapes.push(<rect key="k" x={66} y={2} width={3} height={58} fill={HOT} />);
  }
  if (kind === "silence") {
    for (let i = 0; i < 25; i++) shapes.push(<rect key={`q${i}`} x={rand() * 120} y={rand() * 60} width={1.2} height={1.2} fill={DIM} opacity={0.6} />);
  }
  return (
    <svg viewBox="0 0 120 60" role="img" aria-label={label} className="h-16 w-32 shrink-0 rounded-md border border-white/10 bg-[#06040f]">
      {shapes}
    </svg>
  );
}

/* ---------- The guide ---------- */

const Section = ({ id, title, children }: { id: HelpTopic; title: string; children: ReactNode }) => (
  <section id={`lab-help-${id}`} className="scroll-mt-28 border-t border-white/10 pt-5">
    <h3 className="text-base font-semibold text-white">{title}</h3>
    <div className="mt-2 space-y-3 text-sm leading-6 text-white/75">{children}</div>
  </section>
);

const Example = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5">
    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">{title}</p>
    <div className="mt-1 text-sm leading-6 text-white/80">{children}</div>
  </div>
);

const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="space-y-1.5">
    {items.map((item, index) => (
      <li key={index} className="flex gap-2.5">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-[11px] font-bold text-[#04140c]">{index + 1}</span>
        <span>{item}</span>
      </li>
    ))}
  </ol>
);

const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-white">{children}</b>;

/** The Sound lab guide: opens beside the spectrogram, at the topic you asked about. */
export function SoundLabHelp({ topic, isArabic, onClose }: { topic: HelpTopic; isArabic: boolean; onClose: () => void }) {
  const copy = (en: ReactNode, ar: ReactNode) => (isArabic ? ar : en);
  const text = (en: string, ar: string) => (isArabic ? ar : en);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = scroller.current?.querySelector(`#lab-help-${topic}`);
    if (target && topic !== "start") target.scrollIntoView({ block: "start" });
    else scroller.current?.scrollTo({ top: 0 });
  }, [topic]);

  const contents: [HelpTopic, string][] = [
    ["start", text("Quick start", "بداية سريعة")],
    ["picture", text("Reading the picture", "قراءة الصورة")],
    ["sounds", text("What sounds look like", "شكل الأصوات")],
    ["lane", text("Coloured bar", "الشريط الملوّن")],
    ["numbers", text("The numbers", "الأرقام")],
    ["boxes", text("Draw to fix", "ارسم لتصلح")],
    ["noise", text("Noise & hum", "الضوضاء والطنين")],
    ["bands", text("Frequency bands", "نطاقات التردد")],
    ["volume", text("Volume", "مستوى الصوت")],
    ["listen", text("Listening & saving", "الاستماع والحفظ")],
    ["recipes", text("Recipes", "وصفات جاهزة")],
    ["tips", text("Tips & shortcuts", "نصائح واختصارات")],
  ];
  const jump = (id: HelpTopic) => scroller.current?.querySelector(`#lab-help-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });

  const examples: [ExampleKind, string, ReactNode][] = [
    ["voice", text("Voice", "الصوت البشري"), copy(
      <>Stacks of <B>wavy horizontal stripes</B> in short blocks, brightest between 100 Hz and 1 kHz. Each block is a syllable; the stripes rise and fall with your tone.</>,
      <>طبقات من <B>خطوط أفقية متموجة</B> في كتل قصيرة، أسطعها بين 100 هرتز و1 كيلوهرتز. كل كتلة مقطع صوتي، والخطوط ترتفع وتنخفض مع نبرتك.</>)],
    ["consonants", text("Consonants (s, t, sh)", "الحروف الساكنة (س، ت، ش)"), copy(
      <>Thin <B>vertical streaks reaching high</B> (3–8 kHz) between the syllables. They make words understandable, so don't cut them away.</>,
      <><B>خطوط عمودية رفيعة تصل عاليًا</B> (3–8 كيلوهرتز) بين المقاطع. هي ما يجعل الكلمات مفهومة، فلا تحذفها.</>)],
    ["rumble", text("Rumble (car, wind, AC)", "الهدير (سيارة، رياح، مكيف)"), copy(
      <>A <B>thick band along the very bottom</B> that never stops, even between words. Fix: turn the <B>Rumble</B> band down (−12 to −24 dB).</>,
      <><B>شريط سميك في أسفل الصورة</B> لا يتوقف حتى بين الكلمات. الحل: اخفض نطاق <B>الهدير</B> (−12 إلى −24 ديسيبل).</>)],
    ["hum", text("Electrical hum", "الطنين الكهربائي"), copy(
      <><B>Perfectly straight thin lines</B> low down (50 or 60 Hz, sometimes with copies above), from start to end. Fix: <B>Electrical hum → 50 Hz or 60 Hz</B>.</>,
      <><B>خطوط رفيعة مستقيمة تمامًا</B> في الأسفل (50 أو 60 هرتز وأحيانًا نسخ فوقها) من البداية للنهاية. الحل: <B>الطنين الكهربائي ← 50 أو 60 هرتز</B>.</>)],
    ["hiss", text("Hiss / fan noise", "الهسهسة / المروحة"), copy(
      <>A <B>grainy haze</B> spread over the upper part, visible in the pauses. Fix: <B>Noise reduction</B> (learn it from a pause) and, if needed, lower <B>Air & hiss</B>.</>,
      <><B>ضباب حُبيبي</B> منتشر في الجزء العلوي ويظهر في الوقفات. الحل: <B>تقليل الضوضاء</B> (تعلّمها من وقفة) وعند الحاجة اخفض <B>الهواء والهسهسة</B>.</>)],
    ["music", text("Music", "الموسيقى"), copy(
      <><B>Long, dead-straight lines</B> that hold a pitch, then jump to new ones. Background music under your voice can only be reduced where it doesn't overlap the voice: draw a box around it.</>,
      <><B>خطوط طويلة مستقيمة تمامًا</B> تثبت على نغمة ثم تقفز لأخرى. الموسيقى خلف صوتك تُخفض فقط حيث لا تتداخل معه: ارسم مربعًا حولها.</>)],
    ["click", text("Click, bump, door slam", "نقرة، خبطة، باب"), copy(
      <>A <B>single bright vertical line</B> from bottom to top. Fix: drag a narrow box over it and choose <B>Remove this sound</B> or <B>Quieter</B>.</>,
      <><B>خط عمودي ساطع واحد</B> من الأسفل للأعلى. الحل: اسحب مربعًا ضيقًا فوقه واختر <B>احذف هذا الصوت</B> أو <B>أخفض</B>.</>)],
    ["silence", text("Silence", "الصمت"), copy(
      <><B>Almost black.</B> To remove pauses, use the audio editor's <B>Clean up → Remove silences</B>.</>,
      <><B>شبه أسود.</B> لحذف الوقفات استخدم في محرر الصوت <B>التنظيف ← احذف الصمت</B>.</>)],
  ];

  return (
    <div className="absolute inset-0 z-40 flex" dir={isArabic ? "rtl" : "ltr"}>
      <button type="button" aria-label={text("Close the guide", "أغلق الدليل")} onClick={onClose} className="hidden flex-1 bg-black/50 backdrop-blur-[1px] md:block" />
      <aside role="dialog" aria-label={text("Sound lab guide", "دليل مختبر الصوت")} className="flex h-full w-full flex-col border-white/10 bg-[#0d1117] shadow-2xl md:max-w-xl md:border-s">
        <div className="border-b border-white/10 px-4 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300"><BookOpen size={16} /></span>
            <h2 className="flex-1 text-base font-semibold text-white">{text("Sound lab guide", "دليل مختبر الصوت")}</h2>
            <button type="button" onClick={onClose} aria-label={text("Close the guide", "أغلق الدليل")} className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"><X size={18} /></button>
          </div>
          <nav aria-label={text("Contents", "المحتويات")} className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {contents.map(([id, label]) => (
              <button key={id} type="button" onClick={() => jump(id)} className={`h-7 shrink-0 rounded-full px-2.5 text-[11px] font-medium transition-colors ${id === topic ? "bg-emerald-500 text-[#04140c]" : "bg-white/10 text-white/75 hover:text-white"}`}>{label}</button>
            ))}
          </nav>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-10 pt-4">
          <section id="lab-help-start" className="scroll-mt-28">
            <h3 className="text-base font-semibold text-white">{text("Quick start: fix a recording in 4 steps", "بداية سريعة: أصلح تسجيلًا في 4 خطوات")}</h3>
            <div className="mt-2 text-sm leading-6 text-white/75">
              <Steps items={[
                copy(<>Look at <B>What's in this recording</B>. If problems are listed, press <B>Fix everything suggested</B>.</>, <>انظر إلى <B>ماذا يوجد في هذا التسجيل</B>. إن ظهرت مشكلات فاضغط <B>أصلح كل المقترحات</B>.</>),
                copy(<>Find a pause with no speech, <B>drag sideways</B> over it, and choose <B>This is only noise: learn it</B>.</>, <>ابحث عن وقفة بلا كلام، <B>اسحب أفقيًا</B> فوقها، واختر <B>هذا ضوضاء فقط: تعلّمها</B>.</>),
                copy(<>Press <B>Hear exact result</B> and compare with <B>Original</B>. Too "underwater"? Lower the noise reduction one step.</>, <>اضغط <B>استمع للنتيجة الدقيقة</B> وقارن مع <B>الأصل</B>. يبدو الصوت «تحت الماء»؟ اخفض تقليل الضوضاء درجة.</>),
                copy(<>Press <B>Save improved sound</B>. Your original is always kept; <B>Restore original</B> in the library brings it back.</>, <>اضغط <B>احفظ الصوت المحسّن</B>. الأصل محفوظ دائمًا، و<B>استعادة الأصل</B> في المكتبة تعيده.</>),
              ]} />
            </div>
          </section>

          <Section id="picture" title={text("Reading the picture (spectrogram)", "قراءة الصورة (الطيف الصوتي)")}>
            <p>{copy(<>The picture shows <B>every pitch of your recording over time</B>, like sheet music drawn by the sound itself.</>, <>تعرض الصورة <B>كل طبقات الصوت في تسجيلك عبر الزمن</B>، كأنها نوتة موسيقية يرسمها الصوت بنفسه.</>)}</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>{copy(<><B>Left → right:</B> time, as on the ruler underneath (0:00, 0:05…).</>, <><B>من اليسار لليمين:</B> الزمن، كما في المسطرة أسفلها (0:00، 0:05…).</>)}</li>
              <li>{copy(<><B>Bottom → top:</B> pitch. Deep sounds (engines, hum) at the bottom; sharp sounds (s, hiss) at the top. Labels on the left: 100 Hz, 300 Hz, 1 kHz, 3 kHz, 8 kHz.</>, <><B>من الأسفل للأعلى:</B> طبقة الصوت. الأصوات العميقة (محركات، طنين) في الأسفل، والحادة (س، هسهسة) في الأعلى. على اليسار: 100 هرتز، 300 هرتز، 1 كيلوهرتز، 3، 8.</>)}</li>
              <li>{copy(<><B>Colour:</B> loudness.</>, <><B>اللون:</B> قوة الصوت.</>)}</li>
            </ul>
            <div>
              <div className="h-3 rounded-full" style={{ background: "linear-gradient(90deg, #04060f, #280b54, #781c6d, #c73e4c, #f5871e, #fcf5a0)" }} />
              <div className="mt-1 flex justify-between text-[11px] text-white/55"><span>{text("silent", "صامت")}</span><span>{text("quiet", "هادئ")}</span><span>{text("loud", "عالٍ")}</span><span>{text("loudest", "الأعلى")}</span></div>
            </div>
            <p>{copy(<>The dashed lines split the picture into the five <B>frequency bands</B> (80 Hz, 300 Hz, 3.4 kHz, 8 kHz). The white line is the <B>playhead</B>.</>, <>الخطوط المتقطعة تقسم الصورة إلى <B>نطاقات التردد</B> الخمسة (80 هرتز، 300 هرتز، 3.4 كيلوهرتز، 8 كيلوهرتز). والخط الأبيض هو <B>موضع التشغيل</B>.</>)}</p>
            <Example title={text("Example", "مثال")}>{copy(<>A car recording usually shows bright voice "ladders" in the middle and a <B>solid orange band at the bottom that continues between words</B>: that band is the road, not you.</>, <>تسجيل السيارة يظهر عادة «سلالم» الصوت الساطعة في الوسط و<B>شريطًا برتقاليًا متصلًا في الأسفل يستمر بين الكلمات</B>: هذا الشريط صوت الطريق وليس صوتك.</>)}</Example>
          </Section>

          <Section id="sounds" title={text("What different sounds look like", "كيف تبدو الأصوات المختلفة")}>
            <p>{copy(<>Learn these shapes and you can spot any problem at a glance:</>, <>تعلّم هذه الأشكال وستكتشف أي مشكلة بنظرة:</>)}</p>
            <ul className="space-y-3">
              {examples.map(([kind, name, about]) => (
                <li key={kind} className="flex gap-3">
                  <MiniPicture kind={kind} label={name} />
                  <div className="min-w-0"><p className="font-semibold text-white">{name}</p><p className="text-[13px] leading-5">{about}</p></div>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="lane" title={text("The coloured bar under the picture", "الشريط الملوّن تحت الصورة")}>
            <p>{copy(<>Each second is labelled automatically:</>, <>يُصنَّف كل ثانية تلقائيًا:</>)}</p>
            <ul className="grid grid-cols-2 gap-2 text-[13px]">
              {([["#34d399", text("Voice: someone speaking", "صوت: شخص يتكلم")], ["#a78bfa", text("Music: held notes or chords", "موسيقى: نغمات أو أوتار ممتدة")], ["#fbbf24", text("Noise: only background sound", "ضوضاء: صوت خلفية فقط")], ["#475569", text("Silence: nearly nothing", "صمت: تقريبًا لا شيء")]] as const).map(([colour, label]) => (
                <li key={colour} className="flex items-center gap-2"><span className="h-3 w-6 rounded-full" style={{ background: colour }} />{label}</li>
              ))}
            </ul>
            <p>{copy(<>The percentages above (e.g. <B>Voice 99%</B>) add these up. It is an <B>estimate</B>: the last word before a pause, or singing, can be labelled differently.</>, <>النسب في الأعلى (مثل <B>صوت 99%</B>) مجموع هذه التصنيفات. إنها <B>تقدير</B>: آخر كلمة قبل وقفة أو الغناء قد يُصنَّف بشكل مختلف.</>)}</p>
            <Example title={text("Example", "مثال")}>{copy(<><B>Silence 0%</B> doesn't mean there are no pauses. It means your pauses still contain background noise. In a quiet room the pauses turn grey.</>, <><B>صمت 0%</B> لا يعني عدم وجود وقفات، بل أن وقفاتك فيها ضوضاء خلفية. في غرفة هادئة تصبح الوقفات رمادية.</>)}</Example>
          </Section>

          <Section id="numbers" title={text("The three numbers", "الأرقام الثلاثة")}>
            <ul className="space-y-2">
              <li>{copy(<><B>Voice level</B>: how loud your voice is. 0 dB is the maximum before distortion; <B>−12 to −25 dB</B> is healthy. Below about −26 dB the app suggests evening out loudness.</>, <><B>مستوى الصوت</B>: علو صوتك. 0 ديسيبل هو الحد الأقصى قبل التشوه، و<B>من −12 إلى −25</B> مستوى جيد. تحت −26 تقريبًا يقترح التطبيق توحيد مستوى الصوت.</>)}</li>
              <li>{copy(<><B>Background</B>: how loud the noise is when nobody speaks. The lower the better: <B>−60 dB</B> is a quiet room, <B>−40 dB</B> is a car.</>, <><B>الخلفية</B>: علو الضوضاء عند عدم الكلام. كلما انخفض كان أفضل: <B>−60</B> غرفة هادئة، و<B>−40</B> سيارة.</>)}</li>
              <li>{copy(<><B>Clarity</B>: the gap between the two.</>, <><B>الوضوح</B>: الفرق بين الرقمين.</>)}</li>
            </ul>
            <div className="overflow-hidden rounded-xl border border-white/10 text-[13px]">
              {([[text("Good", "جيد"), text("gap over 30 dB", "فرق أكثر من 30"), text("Nothing needed, or Light noise reduction.", "لا يلزم شيء، أو تقليل خفيف.")], [text("Fair", "متوسط"), text("18–30 dB", "من 18 إلى 30"), text("Light or Medium noise reduction.", "تقليل خفيف أو متوسط.")], [text("Poor", "ضعيف"), text("under 18 dB", "أقل من 18"), text("Strong, learned from a pause. Expect some 'underwater' sound.", "قوي ومتعلَّم من وقفة. قد يظهر أثر «تحت الماء».")]] as const).map(([name, gap, advice]) => (
                <div key={name} className="grid grid-cols-[4.5rem_6.5rem_1fr] gap-2 border-b border-white/10 px-3 py-2 last:border-0"><b className="text-white">{name}</b><span className="text-white/60">{gap}</span><span>{advice}</span></div>
              ))}
            </div>
            <Example title={text("Example", "مثال")}>{copy(<>Voice <B>−23 dB</B>, Background <B>−49 dB</B> → gap 26 dB → <B>Fair</B>. Your voice is clearly above the noise, but the noise is audible in pauses: try <B>Medium</B> noise reduction.</>, <>الصوت <B>−23</B> والخلفية <B>−49</B> ← الفرق 26 ← <B>متوسط</B>. صوتك أعلى من الضوضاء بوضوح لكنها مسموعة في الوقفات: جرّب تقليلًا <B>متوسطًا</B>.</>)}</Example>
          </Section>

          <Section id="boxes" title={text("Draw to fix: remove, soften or boost one sound", "ارسم لتصلح: احذف صوتًا أو اخفضه أو ارفعه")}>
            <Steps items={[
              copy(<><B>Drag a box</B> on the picture around the sound: its width is the time, its height the pitches.</>, <><B>اسحب مربعًا</B> على الصورة حول الصوت: عرضه هو الزمن وارتفاعه طبقات الصوت.</>),
              copy(<>Press <B>Listen to it</B>: you hear only what is inside the box. Adjust until it is just the unwanted sound.</>, <>اضغط <B>استمع إليه</B>: تسمع ما داخل المربع فقط. عدّل حتى يحتوي الصوت غير المرغوب فقط.</>),
              copy(<>Choose <B>Remove this sound</B> (−40 dB), <B>Quieter</B> (−12 dB) or <B>Louder</B> (+6 dB). Boxes appear in red (lower) or green (higher), and are listed under <B>Volume</B>, where you can fine-tune or delete them.</>, <>اختر <B>احذف هذا الصوت</B> (−40) أو <B>أخفض</B> (−12) أو <B>أعلى</B> (+6). تظهر المربعات بالأحمر (خفض) أو الأخضر (رفع)، وتُدرج تحت <B>مستوى الصوت</B> لضبطها أو حذفها.</>),
            ]} />
            <p>{copy(<><B>Drag sideways</B> (almost no height) to select <B>all pitches</B> for that time: useful to make a whole moment quieter or louder.</>, <><B>اسحب أفقيًا</B> (بلا ارتفاع تقريبًا) لتحديد <B>كل الطبقات</B> في ذلك الزمن: مفيد لخفض أو رفع لحظة كاملة.</>)}</p>
            <Example title={text("Examples", "أمثلة")}>
              <ul className="list-disc space-y-1 ps-5">
                <li>{copy(<><B>A phone beep</B>: a short straight line high up. Box it tightly → Remove.</>, <><B>صفارة هاتف</B>: خط مستقيم قصير في الأعلى. أحطه بمربع ضيق ← احذف.</>)}</li>
                <li>{copy(<><B>A cough or loud laugh</B>: a bright block. Drag sideways over it → Quieter.</>, <><B>سعال أو ضحكة عالية</B>: كتلة ساطعة. اسحب أفقيًا فوقها ← أخفض.</>)}</li>
                <li>{copy(<><B>A word you said too softly</B>: drag sideways over it → Louder.</>, <><B>كلمة قلتها بصوت منخفض</B>: اسحب أفقيًا فوقها ← أعلى.</>)}</li>
                <li>{copy(<><B>A car horn</B> between sentences: box it → Remove.</>, <><B>بوق سيارة</B> بين الجمل: أحطه بمربع ← احذف.</>)}</li>
              </ul>
            </Example>
          </Section>

          <Section id="noise" title={text("Noise reduction and electrical hum", "تقليل الضوضاء والطنين الكهربائي")}>
            <p>{copy(<><B>Noise reduction</B> removes steady background sound (road, fan, air conditioning, hiss). <B>Light → Max</B> removes more each step; too much makes the voice sound "underwater" or robotic.</>, <><B>تقليل الضوضاء</B> يزيل الأصوات الخلفية الثابتة (طريق، مروحة، مكيف، هسهسة). من <B>خفيف ← أقصى</B> يزيل أكثر بكل درجة، والزيادة تجعل الصوت «تحت الماء» أو آليًا.</>)}</p>
            <p>{copy(<><B>Teach it your noise</B> for the best result: drag sideways over a pause with <B>no speech at all</B> (half a second is enough) and choose <B>This is only noise: learn it</B>. A blue "noise" mark shows the chosen part.</>, <><B>علّمه ضوضاءك</B> لأفضل نتيجة: اسحب أفقيًا فوق وقفة <B>بلا أي كلام</B> (نصف ثانية تكفي) واختر <B>هذا ضوضاء فقط: تعلّمها</B>. تظهر علامة «ضوضاء» زرقاء على الجزء المختار.</>)}</p>
            <p>{copy(<><B>Electrical hum</B> is a steady buzz from mains power (chargers, lights, cables). It is 50 Hz in most countries (Gulf, Europe, Asia, Africa) and 60 Hz in the Americas and Saudi Arabia. If the app finds it, it marks the right one as <B>found</B>.</>, <><B>الطنين الكهربائي</B> أزيز ثابت من الكهرباء (شواحن، إضاءة، أسلاك). هو 50 هرتز في معظم الدول (الخليج، أوروبا، آسيا، أفريقيا) و60 هرتز في الأمريكتين والسعودية. إن اكتشفه التطبيق يضع علامة <B>موجود</B> على القيمة الصحيحة.</>)}</p>
            <p>{copy(<><B>Soften harsh "s" sounds</B> tames sharp s/sh sounds that hurt in headphones.</>, <><B>نعّم حرف السين الحاد</B> يهذّب أصوات س/ش الحادة المزعجة في السماعات.</>)}</p>
            <Example title={text("Example", "مثال")}>{copy(<>Recorded next to a laptop charger: you see a thin straight line at the bottom of the picture and "Mains hum at 50 Hz" is listed. Press <B>Fix</B>: the line disappears from the result.</>, <>سجّلت بجانب شاحن حاسوب: يظهر خط رفيع مستقيم أسفل الصورة ويُذكر «طنين كهربائي عند 50 هرتز». اضغط <B>أصلح</B>: يختفي الخط من النتيجة.</>)}</Example>
          </Section>

          <Section id="bands" title={text("Frequency bands: shape the sound", "نطاقات التردد: شكّل الصوت")}>
            <p>{copy(<>Each band is a slice of the picture. Slide left to <B>reduce or remove</B> it (to −30 dB), right to <B>enlarge</B> it (to +12 dB). Press the <B>headphones</B> to hear only that band: the fastest way to find where a problem lives.</>, <>كل نطاق شريحة من الصورة. حرّك لليسار <B>للخفض أو الحذف</B> (حتى −30)، ولليمين <B>للتكبير</B> (حتى +12). اضغط <B>السماعة</B> لتسمع هذا النطاق فقط: أسرع طريقة لمعرفة مكان المشكلة.</>)}</p>
            <div className="overflow-hidden rounded-xl border border-white/10 text-[13px]">
              {([
                [text("Rumble", "الهدير"), "20–80 Hz", text("Cut it for car, wind, footsteps, desk bumps. Voices barely use it: −12 to −24 dB is safe.", "اخفضه لأصوات السيارة والرياح والخطوات وخبطات المكتب. الصوت البشري بالكاد يستخدمه: من −12 إلى −24 آمن.")],
                [text("Warmth", "الدفء"), "80–300 Hz", text("Body of the voice. +2 to +4 dB for a fuller voice; −3 dB if it sounds boomy or muffled.", "عمق الصوت. +2 إلى +4 لصوت أغنى، و−3 إن كان مكتومًا أو مدويًا.")],
                [text("Voice", "الصوت"), "300 Hz–3.4 kHz", text("Where words live. +2 to +3 dB makes speech clearer; rarely cut.", "منطقة الكلمات. +2 إلى +3 يجعل الكلام أوضح، ونادرًا ما يُخفض.")],
                [text("Presence", "الحضور"), "3.4–8 kHz", text("Crispness. +2 to +4 dB if dull or far away; −3 dB if harsh.", "الحدة. +2 إلى +4 إن كان باهتًا أو بعيدًا، و−3 إن كان خشنًا.")],
                [text("Air & hiss", "الهواء والهسهسة"), "8–20 kHz", text("Sparkle, but also hiss and fans. −4 to −8 dB to calm hiss.", "لمعان الصوت، وأيضًا الهسهسة والمراوح. −4 إلى −8 لتهدئة الهسهسة.")],
              ] as const).map(([name, range, advice]) => (
                <div key={name} className="grid grid-cols-[5.5rem_1fr] gap-x-2 border-b border-white/10 px-3 py-2 last:border-0">
                  <b className="text-white">{name}<span className="block text-[10px] font-normal text-white/45" dir="ltr">{range}</span></b><span>{advice}</span>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-white/60">{copy(<>The small blue bar beside each slider shows how much of your sound sits in that band.</>, <>الشريط الأزرق الصغير بجانب كل منزلق يوضح نسبة صوتك في هذا النطاق.</>)}</p>
            <Example title={text("Example", "مثال")}>{copy(<>Your voice sounds thin over the phone: <B>Warmth +3</B>, <B>Voice +2</B>, then press <B>Hear exact result</B>.</>, <>صوتك رفيع عبر الهاتف: <B>الدفء +3</B> و<B>الصوت +2</B>، ثم اضغط <B>استمع للنتيجة الدقيقة</B>.</>)}</Example>
          </Section>

          <Section id="volume" title={text("Volume", "مستوى الصوت")}>
            <p>{copy(<><B>Smaller ↔ Bigger</B> changes the whole recording by up to 12 dB (+6 dB sounds about twice as loud).</>, <><B>أصغر ↔ أكبر</B> يغيّر التسجيل كله حتى 12 ديسيبل (+6 تبدو ضعف العلو تقريبًا).</>)}</p>
            <p>{copy(<><B>Even out loudness</B> brings quiet and loud parts to a steady podcast level: best for recordings where you moved away from the phone.</>, <><B>وحّد مستوى الصوت</B> يجعل الأجزاء الهادئة والعالية بمستوى ثابت كالبودكاست: الأفضل لتسجيلات ابتعدت فيها عن الهاتف.</>)}</p>
            <p>{copy(<>A built-in <B>limiter</B> always stops the result from distorting, however much you boost.</>, <>يوجد <B>محدِّد</B> يمنع تشوّه النتيجة دائمًا مهما رفعت.</>)}</p>
          </Section>

          <Section id="listen" title={text("Listening, comparing and saving", "الاستماع والمقارنة والحفظ")}>
            <ul className="list-disc space-y-1 ps-5">
              <li>{copy(<><B>Play</B> plays with your changes live. Switch <B>Original / Improved</B> while it plays to compare instantly.</>, <><B>تشغيل</B> يشغّل مع تعديلاتك مباشرة. بدّل بين <B>الأصل / المحسّن</B> أثناء التشغيل للمقارنة فورًا.</>)}</li>
              <li>{copy(<>Heard live: hum, bands, boxes and volume. <B>Noise reduction, soft "s" and even loudness</B> are heard only with <B>Hear exact result</B>, which processes 15 seconds from the playhead on the server, exactly as it will be saved.</>, <>يُسمع مباشرة: الطنين والنطاقات والمربعات ومستوى الصوت. أما <B>تقليل الضوضاء وتنعيم السين وتوحيد المستوى</B> فتُسمع فقط عبر <B>استمع للنتيجة الدقيقة</B>، التي تعالج 15 ثانية من موضع التشغيل على الخادم كما ستُحفظ تمامًا.</>)}</li>
              <li>{copy(<><B>Save improved sound</B> creates a new version. The original is never lost: <B>Restore original</B> in the library brings it back. <B>Reset</B> clears all settings here.</>, <><B>احفظ الصوت المحسّن</B> ينشئ نسخة جديدة. الأصل لا يضيع أبدًا: <B>استعادة الأصل</B> في المكتبة تعيده. و<B>إعادة ضبط</B> تمسح كل الإعدادات هنا.</>)}</li>
            </ul>
          </Section>

          <Section id="recipes" title={text("Recipes for common situations", "وصفات لحالات شائعة")}>
            {([
              [text("Recorded in the car", "تسجيل في السيارة"), [
                copy(<>Rumble band <B>−18 dB</B>.</>, <>نطاق الهدير <B>−18</B>.</>),
                copy(<>Learn the noise from a pause, noise reduction <B>Medium</B> or <B>Strong</B>.</>, <>تعلّم الضوضاء من وقفة، وتقليل <B>متوسط</B> أو <B>قوي</B>.</>),
                copy(<><B>Presence +2 dB</B> to bring words forward.</>, <><B>الحضور +2</B> لإبراز الكلمات.</>),
              ]],
              [text("Office or home with a buzz", "مكتب أو منزل فيه أزيز"), [
                copy(<>Electrical hum <B>50 Hz</B> (or the one marked "found").</>, <>الطنين الكهربائي <B>50 هرتز</B> (أو المعلَّم «موجود»).</>),
                copy(<>Noise reduction <B>Light</B> for the air conditioning.</>, <>تقليل <B>خفيف</B> لصوت المكيف.</>),
              ]],
              [text("TV or music in the background", "تلفاز أو موسيقى في الخلفية"), [
                copy(<>Box the music <B>between your sentences</B> → Remove.</>, <>أحط الموسيقى <B>بين جملك</B> بمربع ← احذف.</>),
                copy(<>Under your voice it can only be softened: drag sideways → Quieter, or lower <B>Warmth</B> a little.</>, <>تحت صوتك يمكن خفضها فقط: اسحب أفقيًا ← أخفض، أو اخفض <B>الدفء</B> قليلًا.</>),
              ]],
              [text("Phone in a pocket or far away", "الهاتف في الجيب أو بعيد"), [
                copy(<><B>Even out loudness</B> on.</>, <>فعّل <B>توحيد مستوى الصوت</B>.</>),
                copy(<><B>Presence +4 dB</B>, <B>Voice +2 dB</B>; Air & hiss −4 dB if it hisses.</>, <><B>الحضور +4</B> و<B>الصوت +2</B>، والهواء والهسهسة −4 إن ظهرت هسهسة.</>),
              ]],
              [text("Echoey room (bathroom, hall)", "غرفة فيها صدى (حمام، قاعة)"), [
                copy(<>Echo can't be fully removed afterwards. <B>Warmth −3 dB</B> and noise reduction <B>Light</B> help a little.</>, <>لا يمكن إزالة الصدى بالكامل لاحقًا. <B>الدفء −3</B> وتقليل <B>خفيف</B> يساعدان قليلًا.</>),
                copy(<>Next time: record closer to the phone, in a room with curtains or furniture.</>, <>في المرة القادمة: سجّل قريبًا من الهاتف في غرفة فيها ستائر أو أثاث.</>),
              ]],
            ] as const).map(([title, steps]) => (
              <Example key={title} title={title}><Steps items={[...steps]} /></Example>
            ))}
          </Section>

          <Section id="tips" title={text("Tips and shortcuts", "نصائح واختصارات")}>
            <ul className="list-disc space-y-1 ps-5">
              <li>{copy(<><B>Space</B>: play or pause.</>, <><B>المسافة</B>: تشغيل أو إيقاف.</>)}</li>
              <li>{copy(<><B>Tap</B> the picture to move the playhead; <B>mouse wheel</B> or the <B>+ / −</B> buttons to zoom; <B>⤢</B> shows everything.</>, <><B>انقر</B> الصورة لتحريك موضع التشغيل، و<B>عجلة الفأرة</B> أو <B>+ / −</B> للتكبير، و<B>⤢</B> لعرض الكل.</>)}</li>
              <li>{copy(<><B>Esc</B> cancels a box you are drawing.</>, <><B>Esc</B> يلغي المربع الذي ترسمه.</>)}</li>
              <li>{copy(<>Change one thing at a time and listen. <B>Small changes</B> (2–4 dB) sound natural; big ones sound processed.</>, <>غيّر شيئًا واحدًا كل مرة واستمع. <B>التغييرات الصغيرة</B> (2–4 ديسيبل) تبدو طبيعية، والكبيرة تبدو مصطنعة.</>)}</li>
              <li>{copy(<>To remove pauses or cut parts out, use the <B>audio editor</B> (Edit audio). The Sound lab improves sound without changing the length.</>, <>لحذف الوقفات أو قص أجزاء استخدم <B>محرر الصوت</B>. مختبر الصوت يحسّن الصوت دون تغيير الطول.</>)}</li>
            </ul>
          </Section>
        </div>
      </aside>
    </div>
  );
}
