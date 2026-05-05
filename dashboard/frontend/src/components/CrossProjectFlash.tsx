import { useState, useEffect, useCallback } from 'react';

// Cross-project flashes only appear when triggered by real events.
// The bridge or store can dispatch 'venture-os:cross-flash' custom events.

interface FlashData {
  icon: string;
  text: string;
}

export function CrossProjectFlash() {
  const [flash, setFlash] = useState<FlashData | null>(null);

  const showFlash = useCallback((data: FlashData) => {
    setFlash(data);
    setTimeout(() => setFlash(null), 5000);
  }, []);

  useEffect(() => {
    function onFlash(e: Event) {
      const detail = (e as CustomEvent<FlashData>).detail;
      if (detail?.text) showFlash(detail);
    }
    window.addEventListener('venture-os:cross-flash', onFlash);
    return () => window.removeEventListener('venture-os:cross-flash', onFlash);
  }, [showFlash]);

  if (!flash) return null;

  return (
    <div className="cross-flash" key={flash.text}>
      <div className="cross-flash__card">
        <span className="cross-flash__icon">{flash.icon}</span>
        {flash.text}
      </div>
    </div>
  );
}
