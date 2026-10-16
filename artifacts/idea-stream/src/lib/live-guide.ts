/**
 * Workshop guides: the host's "what to do next" (one step at a time, with what to say to the room)
 * and each participant's "what to do now" on their phone. Plain rules on the session's state.
 */

export type Phase = "free" | "think" | "share" | "vote" | "build" | "present";
type GuideState = {
  session: { phase: Phase; status: "open" | "closed" | "ended"; teamCount: number; challenge: string; votesPerPerson: number; synthesis: unknown | null };
  people: Array<{ team: number | null }>;
  cards: Array<{ space: "me" | "team" | "all"; mine: boolean; votes: number | null; myVote: boolean; hidden?: boolean }>;
  me?: { team: number | null } | null;
  votesUsed?: number;
};

export type HostStepId = "challenge" | "screen" | "join" | "teams" | "think" | "share" | "vote" | "build" | "present" | "wrap";
export const HOST_STEPS: HostStepId[] = ["challenge", "screen", "join", "teams", "think", "share", "vote", "build", "present", "wrap"];
const PHASE_STEP: Record<Phase, HostStepId | null> = { free: null, think: "think", share: "share", vote: "vote", build: "build", present: "present" };

/**
 * The host's current step. The room's step wins once the workshop has started; before that, the
 * setup steps in order (a step the host skipped or finished is in `done`).
 */
export function hostStep(state: GuideState, done: ReadonlySet<HostStepId>): HostStepId {
  if (state.session.status === "ended" || done.has("present")) return "wrap";
  const running = PHASE_STEP[state.session.phase];
  if (running) return done.has(running) ? next(running) : running;
  for (const step of HOST_STEPS) {
    if (done.has(step)) continue;
    if (step === "challenge" && state.session.challenge.trim()) continue;
    if (step === "teams" && state.session.teamCount > 0) continue;
    return step;
  }
  return "wrap";
}
const next = (step: HostStepId) => HOST_STEPS[Math.min(HOST_STEPS.length - 1, HOST_STEPS.indexOf(step) + 1)]!;

/** Teams of this size for this many people (2 to 6 per team; small groups get one team). */
export function suggestTeamSize(people: number) {
  if (people <= 5) return Math.max(2, people);
  if (people <= 12) return 3;
  if (people <= 40) return 4;
  return 5;
}

/** Where to vote or build: the team's space or everyone's, whichever has more ideas from others. */
export function bestTab(state: GuideState): "team" | "all" {
  if ((state.me?.team ?? null) === null) return "all";
  const others = (space: "team" | "all") => state.cards.filter((card) => card.space === space && !card.mine && !card.hidden).length;
  return others("all") > others("team") ? "all" : "team";
}

export type Nudge = { emoji: string; en: string; ar: string; go?: "me" | "team" | "all" };

/** What one participant should do now, from the room's step and what they've done. */
export function participantNudge(state: GuideState, tab: "me" | "team" | "all"): Nudge {
  const { phase, status } = state.session;
  const mine = state.cards.filter((card) => card.mine);
  const privateIdeas = mine.filter((card) => card.space === "me").length;
  const sharedIdeas = mine.filter((card) => card.space !== "me").length;
  const team = state.me?.team ?? null;
  if (status === "ended") return { emoji: "🙏", en: "The workshop is over. Thank you! You can still read everything.", ar: "انتهت الورشة. شكرًا لك! ما زال بإمكانك قراءة كل شيء." };
  if (phase === "think") {
    if (tab !== "me") return { emoji: "✍️", en: "Now: write your own ideas in Me.", ar: "الآن: اكتب أفكارك في «أنا».", go: "me" };
    return mine.length === 0
      ? { emoji: "✍️", en: "Write your first idea in the box below and tap Post. Only you will see it.", ar: "اكتب فكرتك الأولى في المربع بالأسفل واضغط «انشر». لن يراها غيرك." }
      : { emoji: "👍", en: `Good: ${mine.length} idea${mine.length === 1 ? "" : "s"}. Write more, or wait for the next step.`, ar: `ممتاز: ${mine.length} فكرة. اكتب المزيد أو انتظر الخطوة التالية.` };
  }
  if (phase === "share") {
    if (team === null) return { emoji: "⏳", en: "The host is putting people in teams. Meanwhile, write ideas in Me.", ar: "المضيف يوزّع الناس على الفرق. حتى ذلك الحين اكتب أفكارك في «أنا».", go: tab === "me" ? undefined : "me" };
    if (privateIdeas > 0 && sharedIdeas === 0) return tab === "me"
      ? { emoji: "🤝", en: "Pick your best idea and tap “Share with my team” under it.", ar: "اختر أفضل فكرة واضغط «شاركها مع فريقي» تحتها." }
      : { emoji: "🤝", en: "Share your best idea: open Me and tap “Share with my team”.", ar: "شارك أفضل فكرة: افتح «أنا» واضغط «شاركها مع فريقي».", go: "me" };
    if (tab !== "team") return { emoji: "👥", en: `Go to your team (Team ${team}) and read their ideas.`, ar: `اذهب إلى فريقك (الفريق ${team}) واقرأ أفكارهم.`, go: "team" };
    return { emoji: "💬", en: "Read your team's ideas: comment 💬 or tap “Build on this” to add to one.", ar: "اقرأ أفكار فريقك: علّق 💬 أو اضغط «ابنِ عليها» لتضيف إليها." };
  }
  if (phase === "vote") {
    const left = state.session.votesPerPerson - (state.votesUsed ?? 0);
    if (left <= 0) return { emoji: "✅", en: "All your dots are placed. Wait for the results on the big screen.", ar: "وضعت كل نقاطك. انتظر النتائج على الشاشة الكبيرة." };
    if (tab === "me") return { emoji: "🗳️", en: "Voting is on your team's and everyone's ideas.", ar: "التصويت على أفكار فريقك وأفكار الجميع.", go: bestTab(state) };
    return { emoji: "🗳️", en: `Tap “Put a dot on this idea” on the ideas you like. ${left} dot${left === 1 ? "" : "s"} left.`, ar: `اضغط «ضع نقطة على هذه الفكرة» على الأفكار التي تعجبك. باقي ${left}.` };
  }
  if (phase === "build") {
    if (tab === "me") return { emoji: "🛠️", en: "Work with your team on the top ideas.", ar: "اعمل مع فريقك على الأفكار الأعلى.", go: bestTab(state) };
    return { emoji: "🛠️", en: "The most-voted idea is first. Tap “Build on this” and add how it would work.", ar: "الفكرة الأعلى تصويتًا في الأعلى. اضغط «ابنِ عليها» وأضف كيف ستعمل." };
  }
  if (phase === "present") return { emoji: "🎤", en: "Teams are presenting. Look at the big screen and listen.", ar: "الفرق تعرض الآن. انظر إلى الشاشة الكبيرة واستمع." };
  // Open: no step yet.
  if (mine.length === 0) return tab === "me"
    ? { emoji: "✍️", en: "Start by writing an idea in the box below. The host will guide the next steps.", ar: "ابدأ بكتابة فكرة في المربع بالأسفل. سيرشدك المضيف إلى الخطوات التالية." }
    : { emoji: "✍️", en: "Start with your own ideas in Me.", ar: "ابدأ بأفكارك في «أنا».", go: "me" };
  return { emoji: "👀", en: "Nice! Keep writing, or look at the big screen for the next step.", ar: "رائع! تابع الكتابة، أو انظر إلى الشاشة الكبيرة للخطوة التالية." };
}
