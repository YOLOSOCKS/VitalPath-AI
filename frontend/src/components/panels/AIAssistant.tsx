import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';

// Shared API base (aligns with Map and backend); use VITE_API_BASE when hitting backend directly
const api = axios.create({
  baseURL: (import.meta as any).env?.VITE_API_BASE || '',
});

interface Message {
  role: 'user' | 'ai';
  text: string;
  timestamp: string;
}

// Matches backend ChatRequest: { message: string; context?: string }
interface ChatRequest {
  message: string;
  context?: string;
}

/** Delay per character for typing effect (ms). Configurable 50–100. */
const TYPING_DELAY_MS = 60;
/** TTS playback rate: < 1 = slower, clearer articulation. */
const TTS_PLAYBACK_RATE = 0.88;

// 1. Wrap in forwardRef to allow App.tsx to 'hold' this component
const glassCardBase = 'bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_0_0_1px_var(--primary-red-glow-rgba-10)] shadow-[0_4px_24px_rgba(0,0,0,0.28)] overflow-hidden';
const glassCardInner = 'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]';
const panelTitleClass = 'text-red-400 font-mono text-sm font-bold tracking-widest uppercase drop-shadow-[0_0_8px_var(--primary-red-glow-rgba-20)]';

const AIAssistant = forwardRef(({ className, isOpen: controlledOpen, onToggle: controlledToggle }: { className?: string; isOpen?: boolean; onToggle?: () => void }, ref) => {
  const [internalOpen, setInternalOpen] = useState(true);
  const isControlled = controlledOpen !== undefined && controlledToggle !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const onToggle = isControlled ? controlledToggle : () => setInternalOpen((o) => !o);
  const [isRedAlert, setRedAlert] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: 'VitalPath AI online. Monitoring temperature, shock, seal & battery. Ask about cargo viability or what to do next.', timestamp: 'NOW' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [typingMessageIndex, setTypingMessageIndex] = useState<number | null>(null);
  const [typingDisplayedLength, setTypingDisplayedLength] = useState(0);
  const lastSpokenMessageRef = useRef<number>(-1);
  const skipNextTTSRef = useRef(false);
  const prevMessagesLengthRef = useRef(0);

  // 2. EXPOSE injectSystemMessage AND speak (for scenario TTS). Typing + TTS are started by the effect when the new message is added.
  useImperativeHandle(ref, () => ({
    injectSystemMessage: async (text: string, shouldSpeak = true) => {
      skipNextTTSRef.current = !shouldSpeak;
      const aiMsg: Message = {
        role: 'ai',
        text: text,
        timestamp: new Date().toLocaleTimeString([], { hour12: false })
      };
      setMessages(prev => [...prev, aiMsg]);
    },
    speak: async (text: string) => handleVoicePlay(text),
  }));

  useEffect(() => {
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body) return;
    const check = () => setRedAlert(body.classList.contains('red-alert'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // When a new AI message is added (messages.length increased), start typing effect and TTS (synced)
  useEffect(() => {
    if (messages.length === 0) return;
    // First run (e.g. initial load): sync ref so we don't type the initial message
    if (prevMessagesLengthRef.current === 0) {
      prevMessagesLengthRef.current = messages.length;
      return;
    }
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (last.role !== 'ai') {
      prevMessagesLengthRef.current = messages.length;
      return;
    }
    const isNewMessage = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    if (typingMessageIndex === lastIdx) return;
    if (typingMessageIndex !== null && typingMessageIndex < lastIdx) {
      setTypingMessageIndex(lastIdx);
      setTypingDisplayedLength(0);
      if (isNewMessage && isVoiceEnabled && !skipNextTTSRef.current) {
        lastSpokenMessageRef.current = lastIdx;
        handleVoicePlay(last.text);
      }
      skipNextTTSRef.current = false;
      return;
    }
    // Only run typing + TTS for newly added messages (not initial load)
    if (!isNewMessage) return;
    setTypingMessageIndex(lastIdx);
    setTypingDisplayedLength(0);
    if (isVoiceEnabled && !skipNextTTSRef.current) {
      lastSpokenMessageRef.current = lastIdx;
      handleVoicePlay(last.text);
    }
    skipNextTTSRef.current = false;
  }, [messages]);

  // Typing interval: advance displayed length until full (do not depend on typingDisplayedLength to avoid resetting interval every tick)
  useEffect(() => {
    if (typingMessageIndex === null || typingMessageIndex >= messages.length) return;
    const fullText = messages[typingMessageIndex].text;
    if (fullText.length === 0) {
      setTypingMessageIndex(null);
      return;
    }
    const t = setInterval(() => {
      setTypingDisplayedLength((prev) => {
        const next = prev + 1;
        if (next >= fullText.length) {
          setTypingMessageIndex(null);
          return fullText.length;
        }
        return next;
      });
    }, TYPING_DELAY_MS);
    return () => clearInterval(t);
  }, [typingMessageIndex, messages]);

  // Scroll to keep latest content in view when messages or typing progress
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetScroll = el.scrollHeight - el.clientHeight;
    if (targetScroll <= 0) return;
    const centeredBottom = Math.max(0, el.scrollHeight - Math.floor(el.clientHeight * 0.6));
    el.scrollTo({ top: centeredBottom, behavior: 'smooth' });
  }, [messages, typingDisplayedLength]);

  // Clean up audio URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (audioRef.current?.src?.startsWith('blob:')) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);

  const handleVoicePlay = async (text: string): Promise<void> => {
    if (!isVoiceEnabled) return;

    try {
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src?.startsWith('blob:')) {
          URL.revokeObjectURL(audioRef.current.src);
        }
      }

      console.log("[TTS] Calling ElevenLabs API:", text.slice(0, 60) + (text.length > 60 ? "…" : ""));
      const res = await api.post('/api/ai/speak',
        { message: text, context: 'general' } as ChatRequest,
        { responseType: 'blob' }
      );

      if (!res.data || (res.data as Blob).size === 0) {
        throw new Error("Empty audio response");
      }

      const audioUrl = URL.createObjectURL(res.data);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.volume = 1.0;
      audio.playbackRate = TTS_PLAYBACK_RATE;
      // Play through Web Audio API for extra gain (louder)
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      const gainNode = ctx.createGain();
      gainNode.gain.value = 2.0;
      const src = ctx.createMediaElementSource(audio);
      src.connect(gainNode);
      gainNode.connect(ctx.destination);
      await audio.play();
    } catch (err) {
      console.error("ElevenLabs Integration Error:", err);
      // Do NOT use static mp3. Fallback to browser speechSynthesis only when ElevenLabs fails.
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        window.speechSynthesis.speak(utterance);
        console.log("[TTS] Fallback: using speechSynthesis");
      } catch (fallbackErr) {
        console.error("speechSynthesis fallback failed:", fallbackErr);
        throw fallbackErr;
      }
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const extractField = (text: string, keys: string[]) => {
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        for (const key of keys) {
          const match = line.match(new RegExp(`\\b${key}\\b\\s*[:\\-]\\s*(.+)`, 'i'));
          if (match?.[1]) return match[1].trim();
        }
      }
      return null;
    };

    const location = extractField(input, ['location', 'address', 'loc']);
    if (location) {
      window.dispatchEvent(new CustomEvent('vitalpath:ai-dispatch', { detail: { location } }));
    }

    const userMsg: Message = { 
      role: 'user', 
      text: input.toUpperCase(), 
      timestamp: new Date().toLocaleTimeString([], { hour12: false }) 
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await api.post<{ response: string }>('/api/ai/chat', {
        message: userMsg.text,
        context: 'general',
      } as ChatRequest);
      const aiText = res.data.response;

      const aiMsg: Message = {
        role: 'ai',
        text: aiText,
        timestamp: new Date().toLocaleTimeString([], { hour12: false })
      };
      
      setMessages(prev => [...prev, aiMsg]);
      // TTS starts from effect when new AI message is detected (synced with typing)

    } catch (err) {
      setMessages(prev => [...prev, { 
        role: 'ai', 
        text: 'ERROR: NEURAL UPLINK FAILED.', 
        timestamp: 'ERR' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const alertBorder = isRedAlert ? 'glass-mission-card--alert border-amber-500/50' : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={!open ? onToggle : undefined}
      onKeyDown={(e) => { if (!open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle?.(); } }}
      className={`glass-mission-card ${glassCardBase} ${glassCardInner} flex flex-col transition-all duration-300 relative z-10 ${alertBorder} ${className} ${open ? 'min-h-0 max-h-[200px] shrink-0' : 'min-h-[56px] h-14 shrink-0 flex-grow-0 cursor-pointer hover:bg-white/5 select-none'}`}
    >
      <div
        onClick={open ? (e) => { e.stopPropagation(); onToggle?.(); } : undefined}
        className="h-14 min-h-[56px] shrink-0 px-4 py-3 border-b border-white/5 flex items-center justify-between cursor-pointer hover:bg-white/5 w-full"
      >
        <div className="flex items-center gap-2 min-w-0">
          <h2 className={`${panelTitleClass} truncate`}>
            CARGO GUARDIAN
          </h2>
          <div className={`w-2 h-2 rounded-full shrink-0 ${isLoading ? 'bg-yellow-400 animate-ping' : 'bg-green-500'}`} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {open && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsVoiceEnabled(!isVoiceEnabled); }}
              className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                isVoiceEnabled ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-gray-800 border-gray-600 text-gray-500'
              }`}
            >
              VOICE: {isVoiceEnabled ? 'ON' : 'OFF'}
            </button>
          )}
          <span className="text-gray-500 text-xs font-mono" aria-hidden>{open ? '▼' : '▲'}</span>
        </div>
      </div>

      {open && (
      <>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 font-mono text-xs scrollbar-thin scrollbar-thumb-red-900">
        {messages.map((m, i) => {
          const isTyping = m.role === 'ai' && i === typingMessageIndex;
          const displayText = isTyping ? m.text.slice(0, typingDisplayedLength) : m.text;
          return (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[90%] p-2 rounded border ${
                m.role === 'user'
                  ? 'bg-red-950/30 border-red-500/50 text-red-100'
                  : 'bg-black/50 border-white/20 text-gray-300'
              }`}>
                {displayText.split('\n').map((line, idx) => (
                  <p key={idx} className="mb-1 leading-relaxed">{line}</p>
                ))}
                {isTyping && typingDisplayedLength < m.text.length && (
                  <span className="inline-block w-2 h-3 ml-0.5 bg-red-400 animate-pulse" aria-hidden />
                )}
              </div>
              <span className="text-[9px] text-gray-600 mt-1">{m.timestamp}</span>
            </div>
          );
        })}
        {isLoading && <div className="text-red-400 animate-pulse font-mono text-[10px] uppercase">Analyzing cargo status...</div>}
      </div>

      <div className="p-3 border-t border-white/5 flex gap-2">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about cargo, route, or next steps..."
          className="flex-1 bg-transparent border-none outline-none text-red-400 font-mono text-xs placeholder-gray-700"
          disabled={isLoading}
        />
        <button 
          onClick={sendMessage}
          disabled={isLoading}
          className={`px-3 py-1 font-mono text-xs transition-all ${
            isLoading 
              ? 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed' 
              : 'bg-red-900/40 border border-red-500/30 text-red-400 hover:bg-red-800/50 hover:border-red-400 shadow-[0_0_10px_var(--primary-red-glow-rgba-10)]'
          }`}
        >
          {isLoading ? '...' : 'SEND'}
        </button>
      </div>
      </>
      )}
    </div>
  );
});

export default AIAssistant;