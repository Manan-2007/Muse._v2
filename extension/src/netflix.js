/**
 * The Netflix tab, as a member of the room.
 *
 * Runs in the isolated world: it can talk to the extension, and it can talk to
 * the MAIN-world bridge over `postMessage`, but it cannot see Netflix's own
 * objects. That division is deliberate — the bridge is the only thing allowed
 * near their internals, so when those change there is exactly one file to fix.
 *
 * The socket itself is not here. It lives in the service worker, because a
 * WebSocket opened from this script would carry `Origin: https://www.netflix.com`
 * — which would mean allowing netflix.com through the API's CORS list, and
 * that is a wide door to open for one tab's convenience. From the worker the
 * origin is `chrome-extension://<id>`: one stable value, allowlisted on
 * purpose, that no web page can forge.
 *
 * What is here is the half that has to be close to the player: the mirror of
 * where the film is, the correction loop, and the judgement about who moved
 * it — the room, or the person sitting in front of it.
 */

/*
 * Wrapped in its own scope, deliberately.
 *
 * Content scripts from one extension in one frame do not each get a module
 * of their own — they share a single global lexical scope, like several
 * classic <script> tags in one page. Two files declaring `const CHANNEL` at
 * top level is therefore not two constants, it is a redeclaration, and it
 * throws `SyntaxError: Identifier 'CHANNEL' has already been declared`
 * before a single line of the second file runs.
 *
 * That is exactly how this broke: the panel was never absent from the page
 * because of anything to do with Netflix, it was absent because this file
 * refused to parse. Nothing here reaches for anything at that scope, so
 * closing it off costs nothing and makes the collision impossible rather
 * than merely currently-avoided. Anything genuinely shared between the two
 * goes through `window.__huddle*`, which is explicit and searchable.
 */
;(() => {
  const CHANNEL = 'huddle-netflix'

  /*
   * Netflix is a coarse source, in the sense the app's own drift correction
   * means: every correction is a seek, and every seek is a rebuffer. There is no
   * fine playback-rate control to absorb small drift into, so the threshold has
   * to be wide enough that it is not paying for a stall to fix something nobody
   * would have noticed.
   */
  const HARD_SECONDS = 2
  /** After a correction, leave it alone. See the app's `useDriftCorrection`. */
  const SEEK_COOLDOWN_MS = 5000
  /** Aim past the target by roughly what the rebuffer will cost. Then measure. */
  const INITIAL_SEEK_COST = 1
  const MAX_SEEK_COST = 1.8
  /** A position jump larger than this, unasked for, is somebody scrubbing. */
  const SCRUB_SECONDS = 1.5

  /** Last state pushed up by the bridge, and when it arrived. */
  let player = null
  /** The room's last known snapshot, and the clock offset to read it against. */
  let room = null
  let offset = 0
  /** Suppress both correction and local-intent reporting until this moment. */
  let settleUntil = 0
  let seekCost = INITIAL_SEEK_COST
  let seekedAt = null
  /** What we last told the room, so an echo is not reported as a new intent. */
  let reported = { paused: null, position: 0, at: 0 }

  const command = (command, extra = {}) =>
    window.postMessage({ channel: CHANNEL, kind: 'command', command, ...extra }, '*')

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.channel !== CHANNEL || data.kind !== 'state') return
    onPlayerState(data)
  })

  /** Where the room says the film should be, right now. */
  function target() {
    if (!room || !room.item) return null
    if (!room.playing) return room.position
    const nowOnServer = Date.now() + offset
    const elapsed = (nowOnServer - room.serverTime) / 1000
    return room.position + elapsed
  }

  /**
   * Did the person in front of the tab just do something?
   *
   * This is the only genuinely hard judgement in the file. Our own corrections
   * move the player too, and a correction reported back to the room as a fresh
   * intent is a loop: everyone seeks, everyone reports the seek, everyone seeks
   * again. So a change only counts as the person's when it happens outside the
   * window in which we were moving things ourselves.
   *
   * A pause is read from the flag flipping. A scrub is read from the position
   * having gone somewhere continuous playback could not have taken it — which is
   * also why the previous reading is kept with its timestamp rather than just
   * its value.
   */
  function detectLocalIntent(next) {
    if (performance.now() < settleUntil) return null
    if (next.buffering) return null

    if (reported.paused === null) return null

    if (next.paused !== reported.paused) {
      return next.paused
        ? { action: 'pause', position: next.position }
        : { action: 'play', position: next.position }
    }

    if (!next.paused) {
      /*
       * A scrub is a position playback could not have reached — which is not
       * the same as a position that is merely behind where it ought to be.
       *
       * Comparing against the expected position alone gets this wrong in the
       * one case that matters most: a player that has stalled reports the same
       * timestamp twice, so after a few seconds it looks exactly like somebody
       * dragged the bar backwards. Reporting that to the room makes everybody
       * seek to a stalled player's position — which stalls them, which they
       * report, and the room walks itself backwards. The stall has to be
       * indistinguishable from nothing happening, because that is what it is.
       *
       * So: backwards is a scrub, and forwards faster than the wall clock is a
       * scrub. Forwards but slow is a player having a hard time.
       */
      const elapsed = (next.at - reported.at) / 1000
      const moved = next.position - reported.position
      if (moved < -SCRUB_SECONDS || moved > elapsed + SCRUB_SECONDS) {
        return { action: 'seek', position: next.position }
      }
    }

    return null
  }

  function onPlayerState(next) {
    const previous = player
    player = next

    if (!next.ready) return

    const intent = previous ? detectLocalIntent(next) : null
    if (intent) {
      /* Ours now — do not read the room's echo of it back as another intent. */
      settleUntil = performance.now() + 600
      chrome.runtime.sendMessage({ kind: 'control', control: intent }).catch(() => undefined)
    }

    reported = { paused: next.paused, position: next.position, at: next.at }
  }

  /**
   * Hold the film to the room.
   *
   * The same shape as the app's own correction loop, minus the rate nudging that
   * Netflix has no way to accept: stand down while buffering, stand down while
   * settling from the last correction, and when correcting, aim past the target
   * by what a seek here has been measured to cost.
   */
  function correct() {
    if (!player || !player.ready || !room || !room.item) return
    /* The room is paused, or nothing is on. Nothing to hold anyone to. */
    if (!room.playing) {
      if (!player.paused) {
        settleUntil = performance.now() + SEEK_COOLDOWN_MS
        command('pause')
      }
      return
    }

    if (player.buffering) return

    /* Recovered from a correction — learn what it actually cost, so the next
       one aims better. Eased, because one slow fetch is not the new normal. */
    if (seekedAt !== null) {
      const cost = (performance.now() - seekedAt) / 1000
      seekCost = Math.min(MAX_SEEK_COST, seekCost * 0.7 + Math.max(0, cost) * 0.3)
      seekedAt = null
    }

    if (performance.now() < settleUntil) return

    const want = target()
    if (want === null) return

    /* The room is running and this player is not. Start it, but do not also
       read the resulting change as the person having pressed play. */
    if (player.paused) {
      settleUntil = performance.now() + SEEK_COOLDOWN_MS
      command('play')
      return
    }

    if (Math.abs(want - player.position) >= HARD_SECONDS) {
      settleUntil = performance.now() + SEEK_COOLDOWN_MS
      seekedAt = performance.now()
      command('seek', { seconds: want + seekCost })
    }
  }

  /**
   * Watching for Netflix routing itself somewhere new.
   *
   * The manifest now matches all of netflix.com rather than only `/watch/*`,
   * on purpose: Netflix is a single-page app, and pressing Play routes there
   * with `history.pushState`, not a real navigation. Chrome only injects a
   * manifest-declared content script on an actual page load — a soft route
   * change is invisible to it — so a script that only matched `/watch/*` would
   * sit on Browse forever and simply never exist on the page anyone is
   * actually watching from. Matching everything and watching the path from
   * inside the one script that's already running is what makes it show up.
   *
   * A poll, not a `popstate` listener, because Netflix's router does not
   * necessarily fire one for every transition it makes — polling the one
   * property that actually matters is cheaper to get right than listening for
   * every event that might precede it changing.
   */
  let lastPath = location.pathname

  function enteredWatchPage() {
    /*
     * A fresh title, not a continuation of the last one.
     *
     * `reported` still holds the previous title's last position — one entry
     * to the next resembles a scrub of several thousand seconds, and without
     * clearing it here that is exactly what the first tick on the new title
     * would report to the room.
     */
    reported = { paused: null, position: 0, at: 0 }
    settleUntil = performance.now() + SEEK_COOLDOWN_MS
    seekCost = INITIAL_SEEK_COST
    seekedAt = null

    const titleId = location.pathname.split('/').filter(Boolean).pop() ?? null
    chrome.runtime.sendMessage({ kind: 'hello', titleId }).catch(() => undefined)
  }

  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname
      if (lastPath.startsWith('/watch/')) enteredWatchPage()
    }
    correct()
  }, 1000)

  /* Already on one — the common case while iterating on the extension itself:
     reload it, then refresh a tab that was on a title the whole time. */
  if (location.pathname.startsWith('/watch/')) enteredWatchPage()

  /*
   * A manual resync, for the overlay's button.
   *
   * `overlay.js` runs in this same isolated world — content scripts from one
   * extension on one frame share a single JS context, so this is a plain
   * function call, not a message that could arrive late or not at all. Clearing
   * the settle window is the whole trick: the loop above is already running
   * every second, so the very next tick treats the gap as due rather than
   * something still cooling down from the last correction.
   */
  window.__huddleResync = () => {
    settleUntil = 0
    correct()
  }

  /* The worker pushes the room down as it changes, and pushes the clock offset
     with it — the offset is measured up there, where the socket is. */
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.kind === 'room') {
      const changed = message.snapshot?.seq !== room?.seq
      room = message.snapshot
      offset = message.offset ?? 0
      /* A deliberate control from anyone — including us — means the player is
         about to move on purpose. Reading that as drift spends a second
         correction on top of the one the room asked for. */
      if (changed) settleUntil = performance.now() + SEEK_COOLDOWN_MS
    }
  })
})()
