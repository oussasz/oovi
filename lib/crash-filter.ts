// Page messages that aren't crashes and must not be reported as errors.
// "ResizeObserver loop…" is the browser saying a size change will be drawn one frame later:
// nothing breaks and the user sees nothing. It was the most reported "error" (6 reports, 3 users).
// Pure (no imports): tests/unit/crash-filter.test.mts.
const NOT_A_CRASH = /^(?:Uncaught )?(?:ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)\.?|Script error\.?)$/i;
export const isRealCrash = (message: string): boolean => !NOT_A_CRASH.test(String(message ?? "").trim());
