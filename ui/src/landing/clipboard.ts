// Puts a connection's name on the clipboard from a menu item, in the window the plugin runs in: the browser in server mode and the native window's web view. The asynchronous clipboard first; where it is missing or
// refuses (no permission, an insecure context) the document's own command on a selected textarea, out of sight, which gives the focus back. The host does the same for its own copy buttons; its helper is not
// part of what a plugin may import.

/** The document's command, on a textarea that holds the text: whether it copied. Never throws. */
function viaCommand(text: string): boolean {
  if (typeof document.execCommand !== 'function') {
    return false;
  }

  const kept = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.tabIndex = -1;
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;inset-block-start:0;inset-inline-start:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    if (kept instanceof HTMLElement && kept.isConnected) {
      kept.focus({ preventScroll: true });
    }
  }
}

/** Copies `text`; whether it did. It never rejects: the caller says what happened. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No permission, an insecure context, or a clipboard that is not there (`navigator.clipboard` is undefined): the document's command is the other way.
    return viaCommand(text);
  }
}
