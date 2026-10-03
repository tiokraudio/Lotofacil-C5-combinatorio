import React from "react";

interface BallProps {
  number: number;
  isHit?: boolean;
  isOfficial?: boolean;
  isSelected?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
}

export const Ball: React.FC<BallProps> = ({
  number,
  isHit = false,
  isOfficial = false,
  isSelected = false,
  size = "md",
  onClick,
  disabled = false,
}) => {
  const formatted = number.toString().padStart(2, "0");

  const sizeClasses = {
    sm: "w-7 h-7 text-xs font-semibold",
    md: "w-9 h-9 text-sm font-bold",
    lg: "w-11 h-11 text-base font-bold",
  }[size];

  let colorClasses = "bg-slate-800 text-slate-300 border border-slate-700/60 hover:border-slate-500";

  if (isHit) {
    colorClasses = "bg-emerald-500/20 text-emerald-300 border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]";
  } else if (isOfficial) {
    colorClasses = "bg-purple-600/30 text-purple-200 border-2 border-purple-500";
  } else if (isSelected) {
    colorClasses = "bg-indigo-600 text-white border-2 border-indigo-400 shadow-md shadow-indigo-500/30";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      className={`rounded-full flex items-center justify-center transition-all duration-150 select-none ${sizeClasses} ${colorClasses} ${
        onClick && !disabled ? "cursor-pointer active:scale-95" : "cursor-default"
      }`}
    >
      {formatted}
    </button>
  );
};
