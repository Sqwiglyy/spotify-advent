const pendingKey = 'mixtape-spotify-pending';
const base64url = bytes => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function connectSpotify(calendar, status) {
  const clientId = window.MIXTAPE_SPOTIFY_CLIENT_ID;
  if (!clientId) {
    status.textContent = 'Spotify playlist saving has not been configured yet.';
    return;
  }
  try {
    const verifier = random();
    const state = random();
    const redirect = location.origin + location.pathname;
    sessionStorage.setItem(pendingKey, JSON.stringify({
      calendar, verifier, state, redirect, createdAt: Date.now()
    }));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirect,
      scope: 'playlist-modify-private',
      code_challenge_method: 'S256',
      code_challenge: base64url(new Uint8Array(digest)),
      state
    });
    location.assign(url.href);
  } catch {
    status.textContent = 'Could not connect to Spotify. Allow session storage and try again.';
  }
}

export async function finishSpotify(api, status) {
  const params = new URLSearchParams(location.search);
  if (!params.has('state')) return null;
  let pending;
  try {
    pending = JSON.parse(sessionStorage.getItem(pendingKey));
  } catch {
    status.textContent = 'Spotify sign-in expired. Reopen your calendar and try again.';
    return null;
  }
  sessionStorage.removeItem(pendingKey);
  if (!pending || params.get('state') !== pending.state ||
      Date.now() - pending.createdAt > 15 * 60 * 1000) {
    status.textContent = 'Spotify sign-in expired. Reopen your calendar and try again.';
    return null;
  }
  const clean = new URL(pending.redirect);
  clean.searchParams.set('code', pending.calendar);
  history.replaceState(null, '', clean);
  if (params.has('error')) {
    status.textContent = 'Spotify connection cancelled. You can try again.';
    return pending.calendar;
  }

  let playlist;
  try {
    status.textContent = 'Making your 24-song playlist…';
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.get('code'),
        redirect_uri: pending.redirect,
        client_id: window.MIXTAPE_SPOTIFY_CLIENT_ID,
        code_verifier: pending.verifier
      })
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error('Spotify sign-in failed. Please connect again.');
    const finale = await api('/' + pending.calendar + '/finale');
    const headers = {
      Authorization: 'Bearer ' + token.access_token,
      'Content-Type': 'application/json'
    };
    const savedKey = 'mixtape-playlist-' + pending.calendar;
    const saved = JSON.parse(sessionStorage.getItem(savedKey) || 'null');
    if (saved?.complete) {
      playlist = saved;
    } else {
      playlist = saved;
      if (!playlist) {
        const response = await fetch('https://api.spotify.com/v1/me/playlists', {
          method: 'POST', headers,
          body: JSON.stringify({
            name: finale.title,
            public: false,
            description: '24 songs picked for you, one December day at a time.'
          })
        });
        const created = await response.json();
        if (!response.ok) throw new Error('Spotify could not create the playlist. Check that this account is approved for the app.');
        playlist = { id: created.id, url: created.external_urls.spotify, complete: false };
        sessionStorage.setItem(savedKey, JSON.stringify(playlist));
      }
      // Replacing the full set allows a retry after a partial failure without adding duplicates.
      const response = await fetch('https://api.spotify.com/v1/playlists/' + playlist.id + '/items', {
        method: 'PUT', headers,
        body: JSON.stringify({
          uris: finale.tracks.map(url => 'spotify:track:' + new URL(url).pathname.split('/').pop())
        })
      });
      if (!response.ok) throw new Error('Your playlist exists, but Spotify could not add the songs. Connect again to retry.');
      playlist.complete = true;
      sessionStorage.setItem(savedKey, JSON.stringify(playlist));
    }
    const link = document.getElementById('saved-playlist');
    link.href = playlist.url;
    link.hidden = false;
    status.textContent = 'Your 24 songs are ready in Spotify.';
  } catch (error) {
    status.textContent = error.message || 'Spotify could not finish the playlist. Please try again.';
  }
  return pending.calendar;
}
