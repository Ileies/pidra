import type { Action } from "svelte/action";

const CLOSE_DISTANCE = 96;
const CLOSE_VELOCITY = 0.5;

/** True when a scrollable ancestor (up to `root`) is scrolled away from its top, so the gesture is a scroll. */
function scrolledAway(from: Element | null, root: HTMLElement): boolean {
  for (let el = from; el; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (el === root) break;
  }
  return false;
}

/**
 * Drag a bottom drawer down with a finger to dismiss it. The drawer follows the finger and closes
 * past a distance or a flick; otherwise it springs back. A drag only starts on a downward move that
 * begins with the drawer's content scrolled to the top, so scrolling long content still works.
 */
export const swipeToClose: Action<HTMLElement, () => void> = (node, onclose) => {
  let close = onclose;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let startTarget: Element | null = null;
  let tracking = false;
  let dragging = false;
  let offset = 0;

  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function reset() {
    node.style.transition = "";
    node.style.transform = "";
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = event.timeStamp;
    startTarget = event.target instanceof Element ? event.target : null;
    tracking = true;
    dragging = false;
    offset = 0;
  }

  function onTouchMove(event: TouchEvent) {
    if (!tracking) return;
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) > Math.abs(dy) || dy < -4) {
        tracking = false;
        return;
      }
      if (dy < 6) return;
      if (scrolledAway(startTarget, node)) {
        tracking = false;
        return;
      }
      dragging = true;
      node.style.transition = "none";
    }

    if (event.cancelable) event.preventDefault();
    offset = Math.max(0, dy);
    node.style.transform = `translateY(${offset}px)`;
  }

  function onTouchEnd(event: TouchEvent) {
    if (!tracking) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;

    const velocity = offset / Math.max(1, event.timeStamp - startTime);
    if (offset < CLOSE_DISTANCE && velocity < CLOSE_VELOCITY) {
      node.style.transition = reducedMotion() ? "" : "transform 150ms ease-out";
      node.style.transform = "";
      return;
    }

    if (reducedMotion()) {
      close();
      reset();
      return;
    }
    node.style.transition = "transform 150ms ease-in";
    node.style.transform = "translateY(100%)";
    setTimeout(() => {
      close();
      reset();
    }, 150);
  }

  function onTouchCancel() {
    if (!dragging) {
      tracking = false;
      return;
    }
    tracking = false;
    dragging = false;
    node.style.transition = "transform 150ms ease-out";
    node.style.transform = "";
  }

  node.addEventListener("touchstart", onTouchStart, { passive: true });
  node.addEventListener("touchmove", onTouchMove, { passive: false });
  node.addEventListener("touchend", onTouchEnd);
  node.addEventListener("touchcancel", onTouchCancel);

  return {
    update(next) {
      close = next;
    },
    destroy() {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchCancel);
    },
  };
};
