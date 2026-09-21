/** Keep application errors visible; ignore stacks belonging entirely to extensions. */
export function shouldShowRuntimeError(error: Pick<Error, "stack">): boolean {
  const frames = (error.stack ?? "").split("\n").filter(line => /^\s*at\s/.test(line));
  const extensionFrame = /(?:\s|\()(?:chrome|moz|safari-web)-extension:\/\//;
  return frames.length === 0 || !frames.every(frame => extensionFrame.test(frame));
}
