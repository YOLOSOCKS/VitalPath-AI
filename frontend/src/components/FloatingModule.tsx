/**
 * Floating module wrapper: dockable card with title bar, collapse, minimize, close.
 * Used for map-centric dashboard panels. Positions via slot to avoid overlap.
 */
import React from 'react';

export type ModuleSlot = 'ai' | 'hospital' | 'nav' | 'vitals';

const SLOT_STYLES: Record<ModuleSlot, { top: string; left?: string; right?: string; width: string; maxHeight: string }> = {
  ai:      { top: '3.75rem', left: '5rem',   width: '340px', maxHeight: '320px' },
  hospital: { top: '24rem',  left: '5rem',   width: '340px', maxHeight: '300px' },
  nav:     { top: '3.75rem', right: '5rem',  width: '320px', maxHeight: '280px' },
  vitals:  { top: '22rem',  right: '5rem',  width: '320px', maxHeight: '300px' },
};

export interface FloatingModuleProps {
  id: ModuleSlot;
  title: string;
  slot: ModuleSlot;
  open: boolean;
  minimized: boolean;
  collapsed: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onCollapseToggle: () => void;
  onRestore: () => void;
  /** Order index when minimized (for stacking pills) */
  minimizedIndex?: number;
  children: React.ReactNode;
}

export default function FloatingModule({
  id,
  title,
  slot,
  open,
  minimized,
  collapsed,
  onClose,
  onMinimize,
  onCollapseToggle,
  onRestore,
  children,
}: FloatingModuleProps) {
  const style = SLOT_STYLES[slot];

  if (!open) return null;

  // Minimized state is rendered by App (pill next to nav icon); we only render when expanded
  if (minimized) return null;

  return (
    <div
      className="fixed z-[45] flex flex-col rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_8px_32px_rgba(0,0,0,0.35)] overflow-hidden transition-all duration-200"
      style={{
        top: style.top,
        left: style.left,
        right: style.right,
        width: style.width,
        maxHeight: collapsed ? 'auto' : style.maxHeight,
      }}
      aria-label={title}
    >
      <div className="shrink-0 h-10 px-3 flex items-center border-b border-white/10 bg-black/30">
        <span className="text-red-400 font-mono text-[10px] font-bold uppercase tracking-widest truncate">
          {title}
        </span>
      </div>
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
