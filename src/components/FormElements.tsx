import React from "react";

/**
 * Common labeling system with optional help hint.
 */
export function FormLabel({ text, hint, children, className = "", theme = "dark" }: {
    text: string;
    hint?: string;
    children: React.ReactNode;
    className?: string;
    theme?: "dark" | "light";
}) {
    const textColor = theme === "light" ? "text-slate-600" : "text-slate-300";
    return (
        <label className={`flex flex-col gap-1.5 ${className}`}>
            <span className={`${textColor} text-sm font-medium flex items-center gap-1.5`}>
                {text}
            </span>
            {hint && (
                <span className="text-[11px] text-slate-500 leading-snug">{hint}</span>
            )}
            {children}
        </label>
    );
}

/**
 * Premium dark input for numbers or text.
 */
export function FormInput({
    type = "text",
    value,
    onChange,
    placeholder,
    disabled,
    className = "",
    min,
    max,
    step,
    title,
    theme = "dark"
}: {
    type?: "text" | "number";
    value: string | number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    min?: number;
    max?: number;
    step?: number;
    title?: string;
    theme?: "dark" | "light";
}) {
    const baseStyle = theme === "light"
        ? "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400"
        : "bg-black/40 border-white/10 text-slate-200 placeholder:text-slate-600";

    return (
        <input
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            min={min}
            max={max}
            step={step}
            title={title}
            className={`
        w-full border rounded-lg px-3 py-2 text-sm outline-none
        ${baseStyle}
        focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 
        transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
        />
    );
}

/**
 * Section header for grouping form elements.
 */
export function SectionHeader({ text, className = "", theme = "dark" }: { text: string; className?: string; theme?: "dark" | "light" }) {
    const borderColor = theme === "light" ? "border-slate-200" : "border-white/5";
    return (
        <h3 className={`text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] py-1 border-b ${borderColor} mb-2 ${className}`}>
            {text}
        </h3>
    );
}

/**
 * Grid layout for form fields.
 */
export function FormGrid({ children, cols = 2, className = "" }: { children: React.ReactNode; cols?: number; className?: string }) {
    const colClass = cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : `grid-cols-${cols}`;
    return (
        <div className={`grid ${colClass} gap-4 ${className}`}>
            {children}
        </div>
    );
}
