import { useSyncExternalStore } from "react";

import { serviceUrl } from "./todoStore";

/** A chat waiting on a timer, from the fork todo service's /waits (see fork/todos/waits.ts). */
export interface ThreadWait {
  threadId: string;
  kind: string;
  startedAt: string;
  deadline: string | null;
}

interface WaitSnapshot {
  waits: ReadonlyMap<string, ThreadWait>;
  now: number;
}

const POLL_MS = 5_000;
let snapshot: WaitSnapshot = { waits: new Map(), now: Date.now() };
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;
// Deadlines seen while still ahead; each pings once when it passes.
const armed = new Set<string>();

function emit(waits = snapshot.waits): void {
  const now = Date.now();
  for (const wait of waits.values()) {
    if (!wait.deadline) continue;
    const key = `${wait.threadId}@${wait.deadline}`;
    const due = Date.parse(wait.deadline);
    if (due > now) armed.add(key);
    else if (armed.delete(key)) ping();
  }
  snapshot = { waits, now };
  for (const listener of listeners) listener();
  // Tick every second only while something is counting.
  if (waits.size > 0 && !tickTimer) tickTimer = setInterval(() => emit(), 1_000);
  if (waits.size === 0 && tickTimer) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }
}

async function poll(): Promise<void> {
  if (document.visibilityState === "hidden" && snapshot.waits.size === 0) return;
  try {
    const response = await fetch(`${serviceUrl()}/waits`);
    if (!response.ok) return;
    const body = (await response.json()) as { waits: ThreadWait[] };
    emit(new Map(body.waits.map((wait) => [wait.threadId, wait])));
  } catch {
    // Service down: keep the last answer; the next poll retries.
  }
}

function ping(): void {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5);
    tone.connect(gain).connect(audio.destination);
    tone.addEventListener("ended", () => void audio.close());
    tone.start();
    tone.stop(audio.currentTime + 0.55);
  } catch {
    // No audio (autoplay blocked or unsupported): the overtime colour still shows.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!pollTimer) {
    void poll();
    pollTimer = setInterval(() => void poll(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    pollTimer = undefined;
    tickTimer = undefined;
  };
}

export function useWaits(): WaitSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
