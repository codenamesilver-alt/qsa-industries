"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function SidebarNavScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Restore scroll position on mount.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = sessionStorage.getItem("sidebar-scroll");
    if (saved) el.scrollTop = Number(saved);
  }, []);

  // Persist scroll position.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => sessionStorage.setItem("sidebar-scroll", String(el.scrollTop));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // After navigation, scroll the active item into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector('[aria-current="page"]') as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [pathname]);

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto pr-1">
      {children}
    </div>
  );
}