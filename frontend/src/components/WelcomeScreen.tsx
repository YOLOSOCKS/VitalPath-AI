import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import VitalPathLogo from '../assets/VITALPATHLOGO.png';

interface WelcomeScreenProps {
    onComplete: () => void;
}

const MISSION_LINES = [
    'Every Minute Counts.',
    'Every Organ Matters.',
    'Every Life Saved.',
];

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
    const [exiting, setExiting] = useState(false);
    const [transitionStage, setTransitionStage] = useState<'idle' | 'pulse' | 'fade'>('idle');
    const timeoutsRef = useRef<number[]>([]);

    useEffect(() => {
        return () => {
            timeoutsRef.current.forEach((id) => window.clearTimeout(id));
        };
    }, []);

    const handleBeginClick = () => {
        if (exiting) return;
        setExiting(true);
        setTransitionStage('pulse');
        timeoutsRef.current.push(window.setTimeout(() => setTransitionStage('fade'), 2000));
        timeoutsRef.current.push(window.setTimeout(() => onComplete(), 2400));
    };

    return (
        <motion.div
            className="welcome-screen welcome-screen-red"
            initial={{ opacity: 1 }}
            animate={exiting ? { opacity: 0, scale: 1.1 } : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'radial-gradient(ellipse at center, var(--welcome-bg-start) 0%, var(--welcome-bg-mid) 50%, var(--welcome-bg-end) 100%)',
                overflow: 'hidden',
                cursor: 'default',
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0.05,
                    backgroundImage: 'linear-gradient(var(--primary-red-glow) 1px, transparent 1px), linear-gradient(90deg, var(--primary-red-glow) 1px, transparent 1px)',
                    backgroundSize: '50px 50px',
                    pointerEvents: 'none',
                }}
            />

            <div className="welcome-scanline welcome-scanline-red" />

            <motion.div
                initial={{ opacity: 0, scale: 0.3, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                style={{ textAlign: 'center', position: 'relative', zIndex: 2 }}
            >
                <motion.img
                    src={VitalPathLogo}
                    alt="VitalPath logo"
                    animate={transitionStage === 'pulse' ? { opacity: [0.35, 1, 0.35], scale: [0.95, 1.08, 0.95] } : { opacity: 1, scale: 1 }}
                    transition={transitionStage === 'pulse' ? { duration: 0.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.6 }}
                    style={{
                        width: 'clamp(120px, 18vw, 200px)',
                        height: 'auto',
                        margin: '0 auto 1.2rem',
                        filter: 'drop-shadow(0 0 25px var(--primary-red-glow-rgba-40))',
                    }}
                />
                <h1
                    style={{
                        fontSize: 'clamp(3rem, 8vw, 6rem)',
                        fontWeight: 900,
                        letterSpacing: '-0.03em',
                        color: 'var(--text-primary)',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                        margin: 0,
                        lineHeight: 1,
                        textShadow: '0 0 40px var(--primary-red-glow-rgba-30), 0 0 80px var(--primary-red-glow-rgba-15)',
                    }}
                >
                    <span style={{ color: 'var(--primary-red-glow)', textShadow: '0 0 40px var(--primary-red-glow-rgba-60), 0 0 80px var(--primary-red-glow-rgba-25)' }}>Vital</span><span style={{ color: 'var(--text-primary)' }}>Path AI</span>
                </h1>

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8, duration: 0.6 }}
                    style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        fontSize: '0.85rem',
                        letterSpacing: '0.3em',
                        color: 'var(--primary-red-glow)',
                        textTransform: 'uppercase',
                        marginTop: '0.75rem',
                        opacity: 0.85,
                    }}
                >
                    Automated Organ Transport Dashboard
                </motion.div>
            </motion.div>

            <div style={{ marginTop: '3rem', textAlign: 'center', position: 'relative', zIndex: 2 }}>
                {MISSION_LINES.map((text, i) => (
                    <motion.div
                        key={text}
                        initial={{ opacity: 0, x: -30 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 1.4 + i * 0.3, duration: 0.6, ease: 'easeOut' }}
                        style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                            fontSize: 'clamp(0.85rem, 2vw, 1.1rem)',
                            letterSpacing: '0.2em',
                            color: i === 2 ? 'var(--primary-red-glow)' : 'var(--text-muted-60)',
                            fontWeight: i === 2 ? 700 : 400,
                            marginBottom: '0.6rem',
                            textShadow: i === 2 ? '0 0 20px var(--primary-red-glow-rgba-50)' : 'none',
                        }}
                    >
                        ▸ {text}
                    </motion.div>
                ))}
            </div>

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 2.6, duration: 0.8 }}
                style={{ marginTop: '4rem', position: 'relative', zIndex: 2 }}
            >
                <motion.button
                    type="button"
                    onClick={handleBeginClick}
                    disabled={exiting}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.98 }}
                    style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        fontSize: '1rem',
                        letterSpacing: '0.35em',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--primary-red-glow)',
                        background: 'var(--primary-red-glow-rgba-08)',
                        border: '2px solid var(--primary-red-glow-rgba-50)',
                        borderRadius: 8,
                        padding: '1rem 2.5rem',
                        cursor: exiting ? 'default' : 'pointer',
                        boxShadow: 'var(--glow-soft-30)',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                    onMouseEnter={(e) => {
                        if (!exiting) {
                            e.currentTarget.style.borderColor = 'var(--primary-red-glow-rgba-90)';
                            e.currentTarget.style.boxShadow = 'var(--glow-strong)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--primary-red-glow-rgba-50)';
                        e.currentTarget.style.boxShadow = 'var(--glow-soft-30)';
                    }}
                >
                    {exiting ? 'Initializing…' : 'Begin'}
                </motion.button>
            </motion.div>

            <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 2.2, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                style={{
                    position: 'absolute',
                    bottom: '2rem',
                    width: '60%',
                    height: 1,
                    background: 'linear-gradient(90deg, transparent, var(--primary-red-glow-rgba-40), transparent)',
                    transformOrigin: 'center',
                    zIndex: 2,
                }}
            />

            <AnimatePresence>
                {exiting && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.3, 0] }}
                        transition={{ duration: 0.6 }}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'radial-gradient(circle, var(--primary-red-glow-rgba-35) 0%, transparent 70%)',
                            zIndex: 10,
                            pointerEvents: 'none',
                        }}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {transitionStage !== 'idle' && (
                    <motion.div
                        key="transition-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: transitionStage === 'fade' ? 0 : 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: 'easeInOut' }}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 20,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'linear-gradient(135deg, #050505 0%, #120607 45%, #2a0a0e 70%, #5b0e18 100%)',
                            overflow: 'hidden',
                        }}
                    >
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                backgroundImage: 'radial-gradient(circle at center, rgba(255, 54, 54, 0.25) 0%, rgba(0, 0, 0, 0.9) 60%)',
                                opacity: 0.9,
                            }}
                        />
                        <motion.img
                            src={VitalPathLogo}
                            alt="VitalPath heart monitor"
                            animate={{ opacity: [0.2, 1, 0.2], scale: [0.9, 1.1, 0.9] }}
                            transition={{ duration: 0.55, repeat: Infinity, ease: 'easeInOut' }}
                            style={{
                                width: 'clamp(160px, 22vw, 260px)',
                                height: 'auto',
                                zIndex: 1,
                                filter: 'drop-shadow(0 0 35px rgba(255, 54, 54, 0.7))',
                            }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default WelcomeScreen;
