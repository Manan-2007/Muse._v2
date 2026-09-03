/**
 * The one thing missing from what already worked: doing it on the page.
 *
 * Everything up to this point required a second tab — open the Huddle app,
 * find Watch, add "Netflix, Prime, others" as a source, type the title. That
 * is a correct description of what has to happen (the room's `item` has to
 * exist before there is anything to hold this tab to), but it is also every
 * bit of friction Teleparty doesn't have. Their whole pitch is that nothing
 * about watching together requires leaving the page you are already on.
 *
 * So this is that: a small panel, drawn over Netflix's own UI, that can
 * start the room watching *this* — the exact title on screen, not a title
 * typed into a form somewhere else — without ever tabbing away.
 *
 * A shadow root, not a plain `<div>`. Netflix's own styles are aggressive
 * (global resets, ids on everything) and reach into any element sharing the
 * page — a shadow root's closed style scope is what stops their CSS from
 * reaching in, and this panel's own styles from reaching out.
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

  let latest = { player: null, room: null, offset: 0 }

  function cleanTitle() {
    /* Netflix's own tab title, once the player has one, is reliably
       "<title> - Netflix" or "<title> | Netflix". Reading it here rather than
       asking the bridge for one keeps this overlay independent of whatever
       internal metadata method that side happens to find working this month. */
    return document.title.replace(/\s*[-|]\s*Netflix\s*$/i, '').trim() || 'This title'
  }

  function buildPanel() {
    const host = document.createElement('div')
    host.id = 'huddle-overlay-host'
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:18px;bottom:18px;'
    const root = host.attachShadow({ mode: 'closed' })

    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .pill {
          display: flex; align-items: center; gap: 8px;
          background: rgba(20,20,22,.92); backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,.1); border-radius: 999px;
          padding: 8px 14px; cursor: pointer; color: #eee; user-select: none;
          box-shadow: 0 8px 24px rgba(0,0,0,.4);
        }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #666; flex: none; }
        .dot.on { background: #4ade80; }
        .dot.wait { background: #fbbf24; }
        .panel {
          display: none; margin-bottom: 10px; width: 260px;
          background: rgba(18,18,20,.96); backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,.1); border-radius: 14px;
          padding: 14px; color: #eee; box-shadow: 0 12px 32px rgba(0,0,0,.5);
        }
        .panel.open { display: block; }
        .row { margin-bottom: 10px; }
        .label { color: #9a9aa0; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
        .value { color: #eee; word-break: break-word; }
        button {
          width: 100%; border: 0; border-radius: 8px; padding: 8px 10px;
          background: #e5484d; color: #fff; font-weight: 600; cursor: pointer;
        }
        button:disabled { opacity: .5; cursor: default; }
        button.ghost { background: rgba(255,255,255,.08); color: #eee; margin-top: 6px; }
        .err { color: #ff9c9c; font-size: 11px; margin-top: 6px; }
      </style>
      <div class="panel" id="panel">
        <div class="row"><div class="label">Status</div><div class="value" id="status">—</div></div>
        <div class="row" id="idleRow">
          <div class="label">Watch this together</div>
          <div id="onTitle">
            <div class="value" id="detectedTitle" style="margin-bottom:8px;"></div>
            <button id="announce">Start the room on this</button>
          </div>
          <div class="value" id="offTitleHint" style="display:none;">
            Open a title on Netflix to start the room on it.
          </div>
        </div>
        <div class="row" id="followingRow" style="display:none;">
          <div class="label">Following</div>
          <div class="value" id="followingTitle"></div>
          <button class="ghost" id="resync">Resync now</button>
        </div>
        <div id="err" class="err" style="display:none;"></div>
      </div>
      <div class="pill" id="pill"><span class="dot" id="dot"></span><span id="pillText">Huddle</span></div>
    `

    document.documentElement.appendChild(host)
    return {
      pill: root.getElementById('pill'),
      panel: root.getElementById('panel'),
      dot: root.getElementById('dot'),
      pillText: root.getElementById('pillText'),
      status: root.getElementById('status'),
      idleRow: root.getElementById('idleRow'),
      followingRow: root.getElementById('followingRow'),
      onTitle: root.getElementById('onTitle'),
      offTitleHint: root.getElementById('offTitleHint'),
      detectedTitle: root.getElementById('detectedTitle'),
      followingTitle: root.getElementById('followingTitle'),
      announce: root.getElementById('announce'),
      resync: root.getElementById('resync'),
      err: root.getElementById('err'),
    }
  }

  function mount() {
    const el = buildPanel()
    let open = false
    let busy = false

    el.pill.addEventListener('click', () => {
      open = !open
      el.panel.classList.toggle('open', open)
    })

    el.announce.addEventListener('click', async () => {
      busy = true
      render()
      el.err.style.display = 'none'
      const title = el.detectedTitle.textContent || cleanTitle()
      const result = await chrome.runtime
        .sendMessage({ kind: 'announce', title, url: location.href })
        .catch((error) => ({ ok: false, error: error?.message ?? String(error) }))
      busy = false
      if (!result?.ok) {
        el.err.textContent = result?.error ?? 'Could not start the room on this.'
        el.err.style.display = 'block'
      }
      render()
    })

    el.resync.addEventListener('click', () => {
      /* Not a network call — the correction loop in netflix.js already knows
         where the room is, and shares this JS context (same extension, same
         frame, same isolated world). This just asks it to look now instead of
         on its own next tick, which is the whole point of pressing a button. */
      window.__huddleResync?.()
    })

    function render() {
      const { player, room, offset } = latest

      const connected = room !== null
      /*
       * Read fresh on every tick rather than watched separately. This already
       * runs once a second regardless, so a dedicated route watcher here would
       * just be a second timer arriving at the same fact.
       */
      const onWatchPage = location.pathname.startsWith('/watch/')

      el.dot.className = 'dot' + (connected ? ' on' : '')
      el.pillText.textContent = connected ? 'Huddle · in sync' : 'Huddle'
      el.status.textContent = connected
        ? `Connected · offset ${Math.round(offset)}ms`
        : 'Not connected — set up the extension from its toolbar icon.'

      const hasRoomItem = Boolean(room?.item)
      el.idleRow.style.display = hasRoomItem ? 'none' : 'block'
      el.followingRow.style.display = hasRoomItem ? 'block' : 'none'

      if (!hasRoomItem) {
        /* Nothing to announce from Browse, My List, or a search — there is no
           single title on screen there, and offering the button anyway would
           mean it announces whatever `document.title` happens to say. */
        el.onTitle.style.display = onWatchPage ? 'block' : 'none'
        el.offTitleHint.style.display = onWatchPage ? 'none' : 'block'
        if (onWatchPage) {
          if (document.activeElement !== el.detectedTitle) el.detectedTitle.textContent = cleanTitle()
          el.announce.disabled = busy || !connected
          el.announce.textContent = busy ? 'Starting…' : 'Start the room on this'
        }
      } else {
        /* Left visible off a title page on purpose — it is useful to see what
           the room is on even from Browse, as the reason to go open it. */
        el.followingTitle.textContent = room.item.title
        el.resync.disabled = !onWatchPage || !player || player.buffering
      }
    }

    render()
    setInterval(render, 1000)

    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.channel !== CHANNEL) return
      if (data.kind === 'state') latest = { ...latest, player: data }
    })

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.kind === 'room') {
        latest = { ...latest, room: message.snapshot, offset: message.offset ?? 0 }
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
})()
