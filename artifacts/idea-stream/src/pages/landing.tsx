import { useLocation } from "wouter";
import { ArrowRight, Image, Link2, Mic, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { isArabic, t } = useLanguage();

  return (
    <main className="min-h-[100dvh] bg-[#e8e8e4] px-6 py-24 flex items-center">
      <div className="mx-auto max-w-5xl w-full grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Idea Stream</p>
          <h1 className="font-serif text-5xl font-semibold leading-tight md:text-6xl">{t("shapeThoughts")}</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">{t("heroSubtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => setLocation("/sign-up")}>
              {t("getStarted")} <ArrowRight className={`ms-2 h-4 w-4 ${isArabic ? "rotate-180" : ""}`} />
            </Button>
            <Button size="lg" variant="outline" onClick={() => setLocation("/sign-in")}>{t("signIn")}</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            [Mic, t("voice")],
            [Image, t("images")],
            [Video, t("videos")],
            [Link2, t("links")],
          ].map(([Icon, label]) => (
            <div key={String(label)} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <Icon className="mb-8 h-7 w-7 text-primary" />
              <p className="font-serif text-xl font-semibold">{String(label)}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}