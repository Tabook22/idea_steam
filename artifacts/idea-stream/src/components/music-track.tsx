import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mic, Minus, Music2, Pencil, Plus, Trash2 } from "lucide-react";
import { getListAudioLibraryQueryKey, mixAudioLibraryItem, removeAudioLibraryMix, type AudioLibraryItem } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

const clock = (seconds: number | null | undefined) => {
  if (seconds == null) return "";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const MIN = -40;
const MAX = 6;

/**
 * The two files behind a recording with background music: your voice, and the song as its own
 * track with a volume control, Edit (opens the mixer) and Remove.
 */
export function MusicTracks({ item, onEdit, dark = false, locked }: { item: AudioLibraryItem; onEdit: () => void; dark?: boolean; locked?: string }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const layer = item.mix;
  const saved = layer?.settings.musicVolume ?? -18;
  const [volume, setVolume] = useState(saved);
  const [busy, setBusy] = useState<"volume" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => { setVolume(saved); }, [saved, item.url]);
  if (!layer) return null;

  const tone = dark
    ? { box: "border-white/10 bg-white/[0.04] text-white", sub: "text-white/50", chip: "bg-white/10 hover:bg-white/20", track: "bg-black/30" }
    : { box: "border bg-card text-foreground", sub: "text-muted-foreground", chip: "bg-secondary hover:bg-secondary/80", track: "bg-muted/60" };
  const changed = volume !== saved;
  const disabled = !!busy || !!locked || layer.musicItemId == null;

  async function applyVolume() {
    if (!layer || layer.musicItemId == null) return;
    setBusy("volume");
    try {
      await mixAudioLibraryItem(item.id, { musicItemId: layer.musicItemId, settings: { ...layer.settings, musicVolume: volume }, target: "same" });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy(`Music volume set to ${volume} dB`, `صوت الموسيقى الآن ${volume} ديسيبل`) });
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't change the volume", "تعذر تغيير الصوت"), description: (error as { data?: { error?: string } })?.data?.error });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      await removeAudioLibraryMix(item.id);
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy("Music removed", "أُزيلت الموسيقى"), description: copy("The recording is back to your voice as it was.", "عاد التسجيل إلى صوتك كما كان.") });
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't remove the music", "تعذرت إزالة الموسيقى"), description: (error as { data?: { error?: string } })?.data?.error });
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  const step = (delta: number) => setVolume((current) => Math.max(MIN, Math.min(MAX, current + delta)));

  return (
    <div className={`rounded-2xl border p-3 ${tone.box}`} role="group" aria-label={copy("Tracks", "المسارات")}>
      <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${tone.sub}`}>{copy("Tracks", "المسارات")}</p>
      <div className="space-y-2">
        <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${tone.track}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-500"><Mic size={15} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{copy("Your voice", "صوتك")}</span>
            <span className={`block text-[11px] ${tone.sub}`}>{clock(layer.voiceDuration)}{layer.pre > 0 && ` · ${copy(`starts at ${clock(layer.pre)}`, `يبدأ عند ${clock(layer.pre)}`)}`}</span>
          </span>
        </div>

        <div className={`rounded-xl px-2.5 py-2 ${tone.track}`}>
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-400"><Music2 size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" dir="auto">{layer.musicTitle || copy("Background music", "موسيقى خلفية")}</span>
              <span className={`block text-[11px] ${tone.sub}`}>{copy("Background music", "موسيقى خلفية")}</span>
            </span>
            <button type="button" onClick={onEdit} disabled={!!busy || !!locked} className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium disabled:opacity-50 ${tone.chip}`}>
              <Pencil size={12} />{copy("Edit", "تعديل")}
            </button>
            {confirm ? (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => void remove()} disabled={!!busy} className="inline-flex h-8 items-center gap-1 rounded-full bg-red-500 px-3 text-xs font-medium text-white hover:bg-red-400">
                  {busy === "remove" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}{copy("Remove", "إزالة")}
                </button>
                <button type="button" onClick={() => setConfirm(false)} className={`h-8 rounded-full px-2 text-xs ${tone.sub}`}>{copy("Keep", "إبقاء")}</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} disabled={!!busy || !!locked} aria-label={copy("Remove the music", "أزل الموسيقى")} title={copy("Remove the music", "أزل الموسيقى")}
                className="grid h-8 w-8 place-items-center rounded-full text-red-500 hover:bg-red-500/10 disabled:opacity-50"><Trash2 size={14} /></button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2" dir="ltr">
            <button type="button" onClick={() => step(-3)} disabled={disabled || volume <= MIN} aria-label={copy("Music quieter", "موسيقى أخفض")} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:opacity-40 ${tone.chip}`}><Minus size={14} /></button>
            <input type="range" min={MIN} max={MAX} step={1} value={volume} disabled={disabled} onChange={(event) => setVolume(Number(event.target.value))}
              aria-label={copy("Music volume", "صوت الموسيقى")} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-violet-500" />
            <button type="button" onClick={() => step(3)} disabled={disabled || volume >= MAX} aria-label={copy("Music louder", "موسيقى أعلى")} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:opacity-40 ${tone.chip}`}><Plus size={14} /></button>
            <span className="w-14 shrink-0 text-end font-mono text-xs tabular-nums">{volume > 0 ? "+" : ""}{volume} dB</span>
          </div>
          {changed && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setVolume(saved)} disabled={!!busy} className={`h-8 rounded-full px-3 text-xs ${tone.sub}`}>{copy("Undo", "تراجع")}</button>
              <button type="button" onClick={() => void applyVolume()} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-500 px-3 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-60">
                {busy === "volume" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}{copy(`Apply ${volume > saved ? "louder" : "quieter"} music`, volume > saved ? "طبّق رفع الموسيقى" : "طبّق خفض الموسيقى")}
              </button>
            </div>
          )}
        </div>
      </div>
      {locked && <p className={`mt-2 text-[11px] ${tone.sub}`}>{locked}</p>}
    </div>
  );
}
