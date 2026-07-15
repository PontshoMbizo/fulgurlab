"use client";

import type { ReactNode, MouseEvent } from "react";

interface IconButtonProps {
    children: ReactNode;
    title: string;
    onClick?: (e: MouseEvent) => void;
    size?: number;
    // "ghost": transparent by default, faint white wash on hover (toolbar
    // buttons). "outline": has a subtle border + faint fill always visible,
    // brighter on hover (reset/fullscreen). Both transcribed from the
    // reference mockup's exact rgba values.
    variant?: "ghost" | "outline";
    active?: boolean;
    activeBg?: string;
    activeColor?: string;
    disabled?: boolean;
}

export default function IconButton({
    children, title, onClick, size = 34, variant = "ghost", active, activeBg, activeColor, disabled,
}: IconButtonProps) {
    const activeStyle = active
        ? { background: activeBg ?? "rgba(255,255,255,.12)", color: activeColor ?? "#fff" }
        : undefined;

    return (
        <button
            title={title}
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            className={
                "flex items-center justify-center rounded-full border-0 transition-all duration-150 " +
                (disabled
                    ? "cursor-not-allowed opacity-40 text-neutral-500"
                    : active
                        ? "cursor-pointer"
                        : variant === "outline"
                            ? "cursor-pointer bg-white/5 text-neutral-400 border border-white/10 hover:text-white hover:bg-white/10"
                            : "cursor-pointer bg-transparent text-neutral-400 hover:text-white hover:bg-white/[0.08]")
            }
            style={{ width: size, height: size, ...activeStyle }}
        >
            {children}
        </button>
    );
}
