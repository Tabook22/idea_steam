import { useEffect, useRef, useState } from "react";
import { Crosshair, Earth, Link2, Loader2, MapPin, Search, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { LiveError } from "@/lib/live-api";
import { placeAt, placeFromLink, placeLinks, searchPlaces, type Place } from "@/lib/calendar-api";

/**
 * Choose where something happens: type a place to search, use where you are now, or paste a Google
 * Maps link. A typed name with no search result is kept as it is.
 */
export function PlacePicker({ value, onChange }: { value: Place | null; onChange: (place: Place | null) => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    const text = query.trim();
    if (text.length < 3 || /^https?:\/\//i.test(text)) { setResults([]); return; }
    timer.current = window.setTimeout(() => {
      setBusy("search");
      void searchPlaces(text).then(setResults).catch(() => setResults([])).finally(() => setBusy(null));
    }, 500);
    return () => window.clearTimeout(timer.current);
  }, [query]);

  const choose = (place: Place) => { onChange(place); setQuery(""); setResults([]); setError(null); };
  async function fromLink(url: string) {
    setBusy("link"); setError(null);
    try { choose(await placeFromLink(url)); }
    catch (failure) { setError(failure instanceof LiveError ? failure.message : copy("That link couldn't be read.", "تعذرت قراءة الرابط.")); }
    finally { setBusy(null); }
  }
  function here() {
    if (!navigator.geolocation) { setError(copy("Location isn't available on this device.", "الموقع غير متاح على هذا الجهاز.")); return; }
    setBusy("here"); setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => { void placeAt(position.coords.latitude, position.coords.longitude).then(choose).catch(() => choose({ name: copy("My location", "موقعي"), lat: position.coords.latitude, lng: position.coords.longitude })).finally(() => setBusy(null)); },
      () => { setBusy(null); setError(copy("Allow location access to use where you are.", "اسمح بالوصول إلى الموقع لاستخدام مكانك.")); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  if (value) return (
    <div className="space-y-2">
      <PlaceView place={value} />
      <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"><X size={13} />{copy("Change the place", "غيّر المكان")}</button>
    </div>
  );
  const isLink = /^https?:\/\//i.test(query.trim());
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} dir="auto" maxLength={300}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (isLink) void fromLink(query.trim()); else if (results[0]) choose(results[0]); else if (query.trim()) choose({ name: query.trim() }); } }}
          placeholder={copy("Search a place, or paste a Google Maps link", "ابحث عن مكان أو الصق رابط خرائط جوجل")} aria-label={copy("Place", "المكان")}
          className="h-11 w-full rounded-xl border bg-background ps-9 pe-3 text-sm outline-none focus:border-primary" />
        {busy === "search" && <Loader2 size={15} className="absolute end-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={here} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium hover:border-primary/50">
          {busy === "here" ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}{copy("Where I am now", "مكاني الآن")}
        </button>
        {isLink && (
          <button type="button" onClick={() => void fromLink(query.trim())} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            {busy === "link" ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}{copy("Use this map link", "استخدم رابط الخريطة")}
          </button>
        )}
        {!isLink && query.trim().length >= 2 && (
          <button type="button" onClick={() => choose({ name: query.trim() })} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs">
            <MapPin size={13} />{copy(`Just “${query.trim().slice(0, 30)}”`, `فقط «${query.trim().slice(0, 30)}»`)}
          </button>
        )}
      </div>
      {results.length > 0 && (
        <ul className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {results.map((place, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(place)} className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-secondary">
                <MapPin size={15} className="mt-0.5 shrink-0 text-rose-500" />
                <span className="min-w-0"><span dir="auto" className="block truncate text-sm font-medium">{place.name}</span><span dir="auto" className="block truncate text-xs text-muted-foreground">{place.address}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

/** A place: its name, a map, and buttons to open it in Google Maps or Google Earth. */
export function PlaceView({ place, compact = false }: { place: Place; compact?: boolean }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const links = placeLinks(place);
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      {links && !compact && (
        <iframe title={place.name} src={links.embed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="block h-48 w-full border-0" />
      )}
      <div className="flex flex-wrap items-center gap-2 p-3">
        <MapPin size={16} className="shrink-0 text-rose-500" />
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-semibold">{place.name}</span>
          {place.address && <span dir="auto" className="block truncate text-xs text-muted-foreground">{place.address}</span>}
        </span>
        {links && (
          <span className="flex gap-1.5">
            <a href={links.maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/70"><MapPin size={12} />{copy("Google Maps", "خرائط جوجل")}</a>
            <a href={links.earth} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/70"><Earth size={12} />{copy("Google Earth", "جوجل إيرث")}</a>
          </span>
        )}
      </div>
    </div>
  );
}
