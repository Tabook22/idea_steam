import { useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Feather, House } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

const isHome = (path: string) => path === "/" || path === "/app";

// The pages visited inside the app, so Back can tell "go back" from "opened directly".
const trail: string[] = [];
function useTrail() {
  const [location] = useLocation();
  useEffect(() => {
    if (trail.at(-1) === location) return;
    if (trail.at(-2) === location) trail.pop(); // went back
    else trail.push(location);
    if (trail.length > 50) trail.splice(0, trail.length - 50);
  }, [location]);
}

/** The Idea Stream mark in the top bar: always leads home. */
export function TopBarHome() {
  const { isArabic } = useLanguage();
  const [location] = useLocation();
  useTrail();
  const home = isHome(location);
  return (
    <div className="flex min-w-0 items-center gap-2">
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

/**
 * On every page but home: "Back" (to the page you came from; opened directly from a link, it goes
 * home) and "Home", both labelled, in the same place on every page.
 */
export function PageNav() {
  const { isArabic } = useLanguage();
  const [location, navigate] = useLocation();
  if (isHome(location)) return null;
  const back = () => {
    if (trail.length > 1) window.history.back();
    else navigate("/app");
  };
  const pill = "inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary active:scale-[0.97]";
  return (
    <nav aria-label={isArabic ? "التنقل" : "Navigation"} className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 pb-2 sm:px-6" data-testid="page-nav">
      <button type="button" onClick={back} className={pill}>
        <ArrowLeft size={17} className="rtl:rotate-180" />{isArabic ? "رجوع" : "Back"}
      </button>
      <Link href="/app" className={pill}>
        <House size={17} />{isArabic ? "الرئيسية" : "Home"}
      </Link>
    </nav>
  );
}
