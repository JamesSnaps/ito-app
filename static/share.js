// Sending a room's link from an invite panel, beside its QR: the share sheet
// where the browser has one (phones, Safari, Chrome on a Mac), otherwise the
// link copied. The QR only works for someone at the table; a link can go
// over Messages to someone on their way.
//
// Plain global, no modules — no build step. Paths are made absolute here,
// from the page's own origin, so no page carries a hard-coded URL.

const Invite = (() => {
  const canShare = () => typeof navigator.share === 'function';
  const canCopy = () => !!(navigator.clipboard && window.isSecureContext);

  function label(){ return canShare() ? 'Send invite' : 'Copy link'; }

  async function send(button, {path, text}){
    const url = new URL(path, location.href).href;
    if (canShare()) {
      try {
        await navigator.share({title: 'Game Night', text, url});
      } catch (e) {
        // Closing the sheet is an AbortError — nothing to say about it.
      }
      return;
    }
    try {
      if (!canCopy()) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      button.textContent = 'Link copied';
      setTimeout(() => { button.textContent = label(); }, 2000);
    } catch (e) {
      // Plain http on the LAN has no clipboard API: hand the link over to
      // copy by hand.
      window.prompt('Copy this link', url);
    }
  }

  // Wire an existing button (a page's static markup).
  function wire(button, options){
    button.textContent = label();
    button.addEventListener('click', () => send(button, options));
    return button;
  }

  // A new button, styled by the page: {path, text, className}.
  function button(options){
    const b = document.createElement('button');
    b.type = 'button';
    if (options.className) b.className = options.className;
    return wire(b, options);
  }

  return {button, wire};
})();
