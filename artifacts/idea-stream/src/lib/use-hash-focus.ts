import { useEffect } from "react";

const HIGHLIGHT = ["ring-2", "ring-primary", "ring-offset-4", "ring-offset-background", "rounded-2xl"];

/**
 * Scrolls to the element named by the URL hash (e.g. #idea-12) once it has rendered,
 * and outlines it briefly so a search result is easy to spot.
 */
export function useHashFocus(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let timer = 0;
    let clear = 0;
    const focus = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      let tries = 0;
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        const element = document.getElementById(id);
        if (!element && ++tries < 30) return;
        window.clearInterval(timer);
        if (!element) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        element.classList.add(...HIGHLIGHT);
        window.clearTimeout(clear);
        clear = window.setTimeout(() => element.classList.remove(...HIGHLIGHT), 2600);
      }, 100);
    };
    focus();
    window.addEventListener("hashchange", focus);
    return () => {
      window.removeEventListener("hashchange", focus);
      window.clearInterval(timer);
      window.clearTimeout(clear);
    };
  }, [ready]);
}
