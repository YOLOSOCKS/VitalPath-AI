import React, { useState, useEffect } from 'react';

const glassCardBase = 'bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_4px_24px_rgba(0,0,0,0.28)] overflow-hidden';
const glassCardInner = 'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]';
const panelTitleClass = 'text-red-400 font-mono text-sm font-bold tracking-widest uppercase drop-shadow-[0_0_8px_var(--primary-red-glow-rgba-20)]';

export default function HospitalInfo({ className }: { className?: string }) {
    const [isOpen, setIsOpen] = useState(true);
    const [isRedAlert, setRedAlert] = useState(false);

    useEffect(() => {
        const body = typeof document !== 'undefined' ? document.body : null;
        if (!body) return;
        const check = () => setRedAlert(body.classList.contains('red-alert'));
        check();
        const mo = new MutationObserver(check);
        mo.observe(body, { attributes: true, attributeFilter: ['class'] });
        return () => mo.disconnect();
    }, []);

    const alertBorder = isRedAlert ? 'glass-mission-card--alert border-amber-500/50' : '';

    return (
        <div
            onClick={() => setIsOpen(!isOpen)}
            className={`glass-mission-card ${glassCardBase} ${glassCardInner} flex flex-col cursor-pointer transition-all duration-300 hover:bg-white/5 ${alertBorder} ${className} ${isOpen ? 'min-h-0' : 'h-12 shrink-0'}`}
        >
            <div className="h-12 shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5">
                <h2 className={panelTitleClass}>
                    Receiving Facility
                </h2>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono">UPLINK: ACTIVE</span>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_var(--success-green)]" />
                    <span className="text-gray-500 text-[10px] font-mono">{isOpen ? '▼' : '▲'}</span>
                </div>
            </div>

            {isOpen && (
                <div className="flex-1 p-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[10px] font-mono content-start">
                    <div className="text-gray-500 uppercase">Cold-chain ready</div>
                    <div className="text-right">
                        <span className="text-emerald-400 font-bold">Yes</span>
                    </div>

                    <div className="text-gray-500 uppercase">Handoff team</div>
                    <div className="text-right">
                        <span className="text-red-400 font-bold">Standing by</span>
                    </div>

                    <div className="text-gray-500 uppercase">OR / Transplant</div>
                    <div className="text-right">
                        <span className="text-red-400 font-bold">Ready</span>
                    </div>

                    <div className="text-gray-500 uppercase">Receiving dock</div>
                    <div className="text-right">
                        <span className="text-emerald-400 font-bold">Open</span>
                    </div>

                    <div className="text-gray-500 uppercase">ETA window</div>
                    <div className="text-right">
                        <span className="text-red-400 font-bold">Within spec</span>
                    </div>

                    <div className="text-gray-500 uppercase">Diversion</div>
                    <div className="text-right">
                        <span className="text-emerald-400 font-bold">OPEN</span>
                    </div>
                </div>
            )}
        </div>
    );
}
