const $ = (id) => document.getElementById(id)

/* The origin the worker's socket will actually present. It has to be on the
   server's allowlist, and there is no way for anyone to guess it in advance —
   Chrome assigns the id — so it is shown here rather than documented. */
$('origin').textContent = location.origin

async function paint() {
  const state = await chrome.runtime.sendMessage({ kind: 'state' }).catch(() => null)
  if (!state) return
  const item = state.snapshot?.item
  const good = state.status === 'connected'
  $('status').innerHTML =
    `<span class="${good ? 'ok' : 'bad'}">${state.status}</span>` +
    (state.config?.roomCode ? `<br />Room: ${state.config.roomCode}` : '') +
    (item ? `<br />On now: ${item.title}` : '<br />Nothing on in the room yet.') +
    (good ? `<br />Clock offset: ${Math.round(state.offset)}ms` : '')

  /* Once it has configured itself there is nothing to hand-enter, so the
     fallback stays folded away rather than sitting there implying there is
     still a step outstanding. */
  const auto = document.getElementById('auto')
  if (auto) auto.style.display = good ? 'none' : 'block'
}

async function prefill() {
  const stored = await chrome.storage.local.get(['server', 'roomCode', 'token', 'suggestedToken'])
  $('server').value = stored.server ?? ''
  $('code').value = stored.roomCode ?? ''
  /* A token picked up from the app tab is offered, never used silently — it
     is in the field where it can be seen and cleared before Connect. */
  $('token').value = stored.token || stored.suggestedToken || ''
}

$('save').addEventListener('click', async () => {
  const button = $('save')
  button.disabled = true
  $('status').textContent = 'Connecting…'

  const server = $('server').value.trim().replace(/\/$/, '')

  let origin
  try {
    origin = new URL(server).origin
  } catch {
    $('status').innerHTML = '<span class="bad">That server URL does not parse.</span>'
    button.disabled = false
    return
  }

  /* Asked for at the moment it is needed, for the one origin just typed,
     rather than demanding every site up front at install time. */
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) {
    $('status').innerHTML =
      '<span class="bad">Permission refused</span><br />The extension cannot reach that server without it.'
    button.disabled = false
    return
  }

  const result = await chrome.runtime.sendMessage({
    kind: 'save',
    server,
    code: $('code').value.trim(),
    token: $('token').value.trim(),
  })

  if (!result?.ok) $('status').innerHTML = `<span class="bad">${result?.error ?? 'Could not connect.'}</span>`
  else setTimeout(paint, 700)

  button.disabled = false
})

void prefill().then(paint)
setInterval(paint, 1500)
