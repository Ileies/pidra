/** Whether a key press landed in something the person is typing into, so a shortcut must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || /^(input|textarea|select)$/i.test(element.tagName);
}
