import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

/** A native select styled as a compact pill: accessible, and large enough to tap. */
export function OptionPill({ icon, label, children, ...props }: {
  icon: ReactNode; label: string; children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="group relative inline-flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full border bg-card ps-3.5 pe-9 text-sm shadow-sm transition-colors hover:border-primary/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="sr-only">{label}</span>
      <select aria-label={label} {...props} className="min-w-0 max-w-[13rem] cursor-pointer appearance-none truncate bg-transparent font-medium outline-none disabled:cursor-not-allowed">
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute end-3 text-muted-foreground" />
    </label>
  );
}

