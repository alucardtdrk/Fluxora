import { cn } from "@/lib/utils";

export function MetricSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-label="Carregando indicador"
      role="status"
      className={cn("mt-3 h-8 w-20 animate-pulse rounded-lg bg-[#eef0f6] dark:bg-white/10", className)}
    />
  );
}
