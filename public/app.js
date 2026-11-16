const byId = id => document.getElementById(id);
const status = byId('status');
const workerUrl = window.MIXTAPE_WORKER_URL || '';
const dialog = document.querySelector('dialog');
const codePattern = /^[A-Z0-9]{6}$/;
const trackPattern = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/[A-Za-z0-9]{22}\/?(?:[?#].*)?$/;
const sections = ['home', 'creator', 'shared', 'calendar'];
let doorRequest;
let refreshTimer;

function show(section) {
  for (const id of sections) byId(id).hidden = id !== section;
  status.textContent = '';
}

async function api(path, options) {
  if (location.hostname.endsWith('.github.io') && !workerUrl) {
    throw new Error('The calendar service URL has not been configured.');
  }
  const response = await fetch(workerUrl + '/api/calendars' + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

const fields = Array.from({ length: 24 }, (_, index) => {
  const label = document.createElement('label');
  label.textContent = 'December ' + (index + 1);
  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'https://open.spotify.com/track/…';
  input.required = true;
  input.maxLength = 500;
  label.append(input);
  byId('tracks').append(label);
  return input;
});

function updateProgress() {
  const count = fields.filter(field => trackPattern.test(field.value.trim())).length;
  byId('progress').textContent = count + ' of 24 song links ready';
  byId('create-button').disabled = count !== 24;
}

byId('start').addEventListener('click', () => {
  show('creator');
  updateProgress();
  fields[0].focus();
});
byId('tracks').addEventListener('input', updateProgress);

byId('create').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('create-button');
  if (button.disabled) return;
  button.textContent = 'Creating…';
  button.disabled = true;
  const fieldset = byId('tracks');
  fieldset.inert = true;
  status.textContent = '';
  try {
    const { code } = await api('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: fields.map(field => field.value.trim()) })
    });
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('code', code);
    document.querySelector('.share-code').textContent = code;
    byId('open-created').href = url.href;
    byId('copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url.href);
        status.textContent = 'Share link copied.';
      } catch {
        status.textContent = url.href;
      }
    };
    show('shared');
  } catch (error) {
    status.textContent = error.message;
  } finally {
    fieldset.inert = false;
    button.textContent = 'Create calendar';
    updateProgress();
  }
});

byId('join').addEventListener('submit', event => {
  event.preventDefault();
  const code = byId('code').value.trim().toUpperCase();
  if (codePattern.test(code)) join(code);
});

function renderCalendar({ code, year, available }) {
  byId('calendar-info').textContent = year + ' · Doors unlock at midnight London time.';
  const doors = Array.from({ length: 24 }, (_, index) => {
    const day = index + 1;
    const button = document.createElement('button');
    const number = document.createElement('strong');
    const state = document.createElement('small');
    button.className = 'door';
    button.disabled = day > available;
    number.textContent = day;
    state.textContent = button.disabled ? 'Locked' : 'Open';
    button.setAttribute('aria-label', 'December ' + day + ', ' + state.textContent);
    button.append(number, state);
    button.onclick = () => openDoor(code, day);
    return button;
  });
  byId('doors').replaceChildren(...doors);
}

async function join(code) {
  const button = byId('join').querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = 'Looking up your calendar…';
  try {
    const data = await api('/' + code);
    show('calendar');
    renderCalendar(data);
    const url = new URL(location.href);
    url.searchParams.set('code', code);
    history.replaceState(null, '', url);
    clearInterval(refreshTimer);
    let available = data.available;
    refreshTimer = setInterval(async () => {
      try {
        const current = await api('/' + code);
        if (current.available !== available) {
          available = current.available;
          renderCalendar(current);
        }
      } catch {
        // Keep the displayed calendar available until the next refresh.
      }
    }, 30000);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function openDoor(code, day) {
  doorRequest?.abort();
  const request = new AbortController();
  doorRequest = request;
  const link = byId('track-link');
  const art = byId('art');
  art.hidden = true;
  art.removeAttribute('src');
  link.hidden = true;
  byId('track-title').textContent = 'December ' + day;
  byId('track-status').textContent = 'Opening the door…';
  dialog.showModal();
  try {
    const track = await api('/' + code + '/doors/' + day, { signal: request.signal });
    if (request.signal.aborted) return;
    link.href = track.url;
    byId('song').textContent = track.title || '';
    if (track.cover) {
      art.onerror = () => { art.hidden = true; };
      art.src = track.cover;
      art.hidden = false;
    }
    link.hidden = false;
    byId('track-status').textContent = track.cover ? '' : 'Spotify artwork is currently unavailable.';
  } catch (error) {
    if (!request.signal.aborted) byId('track-status').textContent = error.message;
  }
}

dialog.addEventListener('close', () => doorRequest?.abort());
const initialCode = new URLSearchParams(location.search).get('code')?.toUpperCase();
if (initialCode && codePattern.test(initialCode)) {
  byId('code').value = initialCode;
  join(initialCode);
}
