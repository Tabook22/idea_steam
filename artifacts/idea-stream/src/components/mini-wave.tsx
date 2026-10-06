import { useEffect, useRef, useState } from "react";
import { getAudioLibraryPeaks } from "@workspace/api-client-react";

/** Waveforms asked for in this session, shared by every row that shows the same file. */
const loaded = new Map<string, Promise<number[]>>();

function peaksFor(id: number, url: string) {
  const key = `${id}:${url}`;
  let found = loaded.get(key);
  if (!found) {
    found = getAudioLibraryPeaks(id).then((result) => result.peaks);
    loaded.set(key, found);
    found.catch(() => loaded.delete(key));
  }
  return found;
}

/**
 * A recording's own little waveform. It's made on the server the first time it scrolls into
 * view, then stored. With `progress`, the played part is coloured in.
 */
export function MiniWave({ id, url, peaks, progress = null, tone = "primary", className = "" }: {
  id: number;
  url: string;
  peaks: number[] | null;
  /** 0–1 when this recording is playing. */
  progress?: number | null;
  tone?: "primary" | "music";
  className?: string;
}) {
  const [values, setValues] = useState<number[] | null>(peaks);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (peaks) setValues(peaks); }, [peaks]);
  useEffect(() => {
    if (peaks || !box.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      peaksFor(id, url).then((result) => { if (!cancelled) setValues(result); }).catch(() => {});
    }, { rootMargin: "200px" });
    observer.observe(box.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [id, url, peaks]);

  const played = progress === null ? -1 : progress * (values?.length ?? 0);
  const color = tone === "music" ? "bg-violet-500" : "bg-primary";
  return (
    <div ref={box} aria-hidden="true" dir="ltr" className={`flex items-center gap-[2px] ${className}`}>
      {(values ?? Array.from({ length: 64 }, () => 0)).map((value, index) => (
        <span
          key={index}
          className={`min-w-[1.5px] flex-1 rounded-full transition-[height,opacity] duration-500 ${color} ${
            progress === null ? "opacity-30" : index < played ? "opacity-100" : "opacity-25"
          }`}
          style={{ height: values ? `${Math.max(10, value * 100)}%` : "10%" }}
        />
      ))}
    </div>
  );
}
