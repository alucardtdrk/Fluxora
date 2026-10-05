import { useId } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import type { DashboardPeriod } from "@/lib/preferences";

export default function PeriodFilter({ value, options, onChange, className = "" }: {
  value: DashboardPeriod;
  options: readonly (readonly [DashboardPeriod, string])[];
  onChange: (value: DashboardPeriod) => void;
  className?: string;
}) {
  const id = useId();
  const reducedMotion = useReducedMotion();
  return <LayoutGroup id={id}>
    <div role="group" aria-label="Período das execuções" className={`flex flex-wrap rounded-xl border bg-card p-1 ${className}`}>
      {options.map(([period, label]) => <button key={period} type="button" aria-pressed={value === period} onClick={() => onChange(period)} className={`relative rounded-lg px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === period ? "text-background" : "text-muted-foreground"}`}>
        {value === period && <motion.span aria-hidden="true" layoutId={reducedMotion ? undefined : "active-period"} initial={false} transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeInOut" }} className="pointer-events-none absolute inset-0 rounded-lg bg-foreground" />}
        <span className="relative z-10">{label}</span>
      </button>)}
    </div>
  </LayoutGroup>;
}
