// Global Esc key stack — the most recently registered handler fires when Escape is pressed.
// Stored on window to survive Vite HMR module re-evaluations in development.
type EscHandler = () => void;

declare global {
  interface Window { __escStack?: EscHandler[]; __escStackInited?: boolean; }
}

if (!window.__escStack) window.__escStack = [];

if (!window.__escStackInited) {
  window.__escStackInited = true;
  // capture:true fires before React synthetic events so no component can intercept it
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const stack = window.__escStack!;
    if (stack.length === 0) return;
    e.preventDefault();
    stack[stack.length - 1]();
  }, true);
}

export const escStack = {
  push(fn: EscHandler): void { window.__escStack!.push(fn); },
  pop(fn: EscHandler): void {
    const i = window.__escStack!.lastIndexOf(fn);
    if (i >= 0) window.__escStack!.splice(i, 1);
  },
};
