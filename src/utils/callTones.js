/**
 * Ringtone and ringback, generated rather than loaded from files. Browsers may refuse
 * sound before someone has clicked on the page, so the on-screen popup is always the
 * main signal and these fail silently.
 */
const PATTERNS = {
  incoming: { frequencies: [660, 880], on: 0.9, every: 2.4, volume: 0.12 },
  outgoing: { frequencies: [400, 450], on: 0.8, every: 3, volume: 0.05 },
};

export function playCallTone(kind) {
  const pattern = PATTERNS[kind];
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!pattern || !AudioContextClass) return () => {};

  let context;
  let timer;
  try {
    context = new AudioContextClass();
    context.resume?.().catch(() => {});

    const beep = () => {
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(pattern.volume, now + 0.03);
      gain.gain.setValueAtTime(pattern.volume, now + pattern.on - 0.05);
      gain.gain.linearRampToValueAtTime(0, now + pattern.on);
      gain.connect(context.destination);
      pattern.frequencies.forEach((frequency) => {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(now);
        oscillator.stop(now + pattern.on);
      });
    };

    beep();
    timer = setInterval(beep, pattern.every * 1000);
  } catch {
    return () => {};
  }

  return () => {
    clearInterval(timer);
    context.close?.().catch(() => {});
  };
}
