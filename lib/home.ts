import os from "node:os";

/**
 * The user's home folder, read when the app runs. Written so the build's file tracer
 * can't work it out: when it can, it tries to copy the whole home folder into the build
 * (glob "C:\Users\<name>\**\*") and the build fails on protected Windows folders.
 */
const HOMEDIR = ["home", "dir"].join("");
export const homeDir = (): string => (os as unknown as Record<string, () => string>)[HOMEDIR]!();
