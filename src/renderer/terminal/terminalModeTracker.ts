/**
 * DEC mode tracking for xterm.js DECRQM workaround.
 *
 * xterm.js 6.0.0 has a bug where the built-in DECRQM (Request Mode)
 * handler crashes with "r is not defined" when TUI apps send
 * mode-query escape sequences (CSI Ps $ p / CSI ? Ps $ p).
 *
 * This module registers custom handlers that intercept these sequences
 * and return accurate DECRPM responses, tracking runtime DEC mode state
 * as TUI apps toggle modes via CSI ? h / CSI ? l.
 */

type CleanupFn = () => void;

/**
 * DEC private mode default states.
 * Returning accurate state (instead of blanket "not recognized") lets
 * TUI apps like Claude Code properly manage cursor visibility, scroll
 * regions, and other modes — preventing state corruption.
 *
 * Pm values: 0=not recognized, 1=set, 2=reset, 3=permanently set, 4=permanently reset
 */
const DEC_MODE_DEFAULTS: Record<number, number> = {
  1: 2, // DECCKM: reset (normal cursor keys)
  7: 1, // DECAWM: set (auto wraparound on)
  25: 1, // DECTCEM: set (cursor visible)
  1049: 2, // Alt screen buffer: reset (main screen)
  2004: 2, // Bracketed paste: reset (off)
};

/**
 * Set up DEC mode tracking and DECRQM response handlers on an xterm.js parser.
 *
 * @param parser - The xterm.js parser instance (accessed via `(terminal as any).parser`)
 * @param ptyId - The PTY ID to send responses back to
 * @param sendInput - Function to send data back to the PTY (e.g. `window.electronAPI.ptyInput`)
 * @returns Array of cleanup functions to call on dispose
 */
export function setupDECModeTracking(
  parser: any,
  ptyId: string,
  sendInput: (args: { id: string; data: string }) => void
): CleanupFn[] {
  if (!parser?.registerCsiHandler) return [];

  const decModeState = new Map<number, number>(
    Object.entries(DEC_MODE_DEFAULTS).map(([k, v]) => [Number(k), v])
  );

  // Track CSI ? h (set) — update tracked modes to "set" (1)
  const decSetDisp = parser.registerCsiHandler(
    { prefix: '?', final: 'h' },
    (params: (number | number[])[]) => {
      for (const p of params) {
        if (typeof p === 'number' && decModeState.has(p)) {
          decModeState.set(p, 1);
        }
      }
      return false; // let xterm.js also process the sequence
    }
  );

  // Track CSI ? l (reset) — update tracked modes to "reset" (2)
  const decResetDisp = parser.registerCsiHandler(
    { prefix: '?', final: 'l' },
    (params: (number | number[])[]) => {
      for (const p of params) {
        if (typeof p === 'number' && decModeState.has(p)) {
          decModeState.set(p, 2);
        }
      }
      return false; // let xterm.js also process the sequence
    }
  );

  // ANSI mode request: CSI Ps $ p  →  respond CSI Ps ; 0 $ y
  const ansiDisp = parser.registerCsiHandler(
    { intermediates: '$', final: 'p' },
    (params: (number | number[])[]) => {
      const mode = (params[0] as number) ?? 0;
      sendInput({ id: ptyId, data: `\x1b[${mode};0$y` });
      return true;
    }
  );

  // DEC private mode request: CSI ? Ps $ p  →  respond CSI ? Ps ; Pm $ y
  const decDisp = parser.registerCsiHandler(
    { prefix: '?', intermediates: '$', final: 'p' },
    (params: (number | number[])[]) => {
      const mode = (params[0] as number) ?? 0;
      const pm = decModeState.get(mode) ?? 0;
      sendInput({ id: ptyId, data: `\x1b[?${mode};${pm}$y` });
      return true;
    }
  );

  return [
    () => ansiDisp.dispose(),
    () => decDisp.dispose(),
    () => decSetDisp.dispose(),
    () => decResetDisp.dispose(),
  ];
}
