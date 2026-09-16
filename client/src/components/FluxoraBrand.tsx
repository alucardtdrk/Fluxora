export function FluxoraMark({ className = "h-10 w-10", light = false }: { className?: string; light?: boolean }) {
  return <img src="/fluxora-mark-transparent.png" alt="" aria-hidden="true" className={`shrink-0 object-contain ${light ? "brightness-0 invert drop-shadow-[0_2px_6px_rgba(40,110,247,0.45)]" : ""} ${className}`} />;
}

export function FluxoraBrand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <FluxoraMark light={light} className={compact ? "h-9 w-9" : "h-11 w-11"} />
      {!compact && (
        <div className="leading-none">
          <div className={`text-lg font-bold tracking-[-0.055em] ${light ? "text-white" : "text-[#280E59]"}`}>Fluxora</div>
          <div className={`mt-1 text-[10px] font-semibold tracking-[0.04em] ${light ? "text-[#D9CEEF]" : "text-[#72668A]"}`}>Automation Control Center</div>
        </div>
      )}
    </div>
  );
}
