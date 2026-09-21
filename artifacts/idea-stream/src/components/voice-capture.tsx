import { Link } from "wouter";
import { Mic, Square } from "lucide-react";
import { useRecorder } from "@/components/recorder-provider";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export function VoiceCapture({ subjectId }: { subjectId: number }) {
  const { start, stop, stage, seconds, ready, error, rescue } = useRecorder();
  const { isArabic } = useLanguage();
  return (
    <div className="flex flex-col items-center text-center rounded-xl bg-primary/5 p-7 gap-4">
      <Button
        className="h-24 w-24 rounded-full"
        aria-label={isArabic ? "تسجيل فكرة" : "Record an idea"}
        variant={stage === "recording" ? "destructive" : "default"}
        disabled={
          !ready || !!rescue || stage === "starting" || stage === "saving"
        }
        onClick={() => (stage === "recording" ? stop() : void start(subjectId))}
      >
        {stage === "recording" ? (
          <Square className="!h-8 !w-8" />
        ) : (
          <Mic className="!h-8 !w-8" />
        )}
      </Button>
      <p className="font-medium">
        {stage === "recording"
          ? isArabic
            ? "إيقاف وحفظ تلقائي"
            : "Stop & save automatically"
          : isArabic
            ? "سجّل مباشرة لهذا الدفتر"
            : "Record directly into this notebook"}
      </p>
      {stage !== "idle" && (
        <p role="timer" className="font-mono text-xl">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </p>
      )}
      <p className="text-xs text-muted-foreground leading-6">
        {isArabic
          ? "يُحفظ الصوت على الجهاز أولًا ويُزامن تلقائيًا. نصك المكتوب محفوظ منفصلًا ولم يتغير."
          : "Audio saves to this device first, then syncs automatically. Any typed draft stays separate and unchanged."}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Link href="/record" className="text-sm underline text-primary">
        {isArabic
          ? "فتح المسجل والتسجيلات المحفوظة"
          : "Open recorder & saved recordings"}
      </Link>
    </div>
  );
}
