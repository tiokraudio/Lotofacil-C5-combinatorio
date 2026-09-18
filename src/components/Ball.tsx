import React from "react";
import { pad2 } from "../storage/service.ts";

export type BallVariant = "default" | "hit" | "miss" | "selectable" | "official";

interface BallProps {
  number: number;
  variant?: BallVariant;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  ariaLabel?: string;
}

export const Ball: React.FC<BallProps> = ({
  number,
  variant = "default",
  selected = false,
  disabled = false,
  onClick,
  size = "md",
  ariaLabel,
}) => {
  const formatted = pad2(number);

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm font-semibold",
    lg: "w-12 h-12 text-base font-bold",
  }[size];

  // Base styling: sem cassino/ludicidade, foco em legibilidade e clareza técnica
  let variantClasses = "bg-zinc-800 border-zinc-700 text-zinc-200";

  if (variant === "official") {
    variantClasses = "bg-emerald-950/80 border-emerald-500/80 text-emerald-200 shadow-xs";
  } else if (variant === "hit") {
    variantClasses = "bg-emerald-950/70 border-emerald-500 text-emerald-200 font-bold ring-1 ring-emerald-500/40";
  } else if (variant === "miss") {
    variantClasses = "bg-zinc-900/60 border-zinc-800 text-zinc-400 opacity-60";
  } else if (variant === "selectable") {
    if (selected) {
      variantClasses = "bg-emerald-600 border-emerald-400 text-white shadow-xs scale-105 font-bold ring-2 ring-emerald-400/50";
    } else {
      variantClasses = disabled
        ? "bg-zinc-900/40 border-zinc-800/60 text-zinc-400 cursor-not-allowed opacity-40"
        : "bg-zinc-800/90 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:border-zinc-500 cursor-pointer active:scale-95";
    }
  }

  if (variant === "selectable") {
    return (
      <button
        type="button"
        id={`ball-btn-${formatted}`}
        onClick={onClick}
        disabled={disabled && !selected}
        aria-pressed={selected}
        aria-label={ariaLabel || `Dezena ${formatted}${selected ? " selecionada" : ""}`}
        className={`inline-flex items-center justify-center rounded-lg border transition-all duration-150 select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${sizeClasses} ${variantClasses}`}
      >
        <span>{formatted}</span>
      </button>
    );
  }

  return (
    <div
      id={`ball-display-${formatted}`}
      aria-label={ariaLabel || `Dezena ${formatted}${variant === "hit" ? " (acerto)" : ""}`}
      className={`relative inline-flex items-center justify-center rounded-lg border transition-colors select-none ${sizeClasses} ${variantClasses}`}
    >
      <span>{formatted}</span>
      {variant === "hit" && (
        <span
          className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full border border-zinc-950"
          title="Acerto"
          aria-hidden="true"
        />
      )}
    </div>
  );
};
