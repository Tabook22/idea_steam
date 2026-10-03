import { useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Feather } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

const isHome = (path: string) => path === "/" || path === "/app";

/**
 * Back button (every page except home) and the Idea Stream mark, which always leads home.
 * Back follows your path inside the app; opened directly (from a share or a link), it goes home.
 */
export function TopBarHome() {
  const { isArabic } = useLanguage();
  const [location, navigate] = useLocation();
  const trail = useRef<string[]>([]);

  useEffect(() => {
    const stack = trail.current;
    if (stack.at(-1) === location) return;
    if (stack.at(-2) === location) stack.pop(); // went back
    else stack.push(location);
    if (stack.length > 50) stack.splice(0, stack.length - 50);
  }, [location]);

  const back = () => {
    if (trail.current.length > 1) window.history.back();
    else navigate("/app");
  };
  const home = isHome(location);

  return (
    <div className="flex min-w-0 items-center gap-2">
      {!home && (
        <button
          type="button"
          onClick={back}
          aria-label={isArabic ? "رجوع" : "Back"}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border bg-card text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary active:scale-95"
        >
          <ArrowLeft size={19} className="rtl:rotate-180" />
        </button>
      )}
      <Link
        href="/app"
        aria-label={isArabic ? "Idea Stream: الصفحة الرئيسية" : "Idea Stream: home"}
        // On the desktop home page the sidebar already shows the brand.
        className={`flex min-w-0 items-center gap-2 rounded-full pe-2 text-foreground transition-opacity hover:opacity-80 ${home ? "md:hidden" : ""}`}
      >
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-deep text-white shadow-sm">
          <Feather size={19} />
          <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-brand-deep" aria-hidden="true" />
        </span>
        <span className="hidden truncate text-[17px] font-semibold tracking-tight min-[420px]:inline">
          idea<span className="font-normal">stream</span>
        </span>
      </Link>
    </div>
  );
}
