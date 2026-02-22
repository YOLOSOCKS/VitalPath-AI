import { useState, useEffect, useCallback } from 'react';

export default function useTextToSpeech() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    // Load available system voices
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      // Try to find a "Google US English" or "Microsoft Zira" (Sci-fi female voice)
      const sciFiVoice = voices.find(v => v.name.includes("Google US English")) || 
                         voices.find(v => v.name.includes("Zira")) || 
                         voices[0];
      setVoice(sciFiVoice);
    };

    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }, []);

  const speak = useCallback((text: string) => {
    if (!voice) return;

    // Cancel any current speech so new urgent messages cut through
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.pitch = 1.0; 
    utterance.rate = 1.1; // Slightly faster for "Urgency"
    utterance.volume = 1.0;

    window.speechSynthesis.speak(utterance);
  }, [voice]);

  return { speak };
}