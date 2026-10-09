// One low-frequency discovery loop for features that follow YouTube's changing
// player and media elements. Feature-specific readiness/retry policies live in
// their callers; there are no DOM-wide observers or per-feature scan intervals.
const DISCOVERY_INTERVAL_MS = 2000;
const listeners = { player: [], video: [], videoId: [] };
let currentPlayer = null;
let currentVideo = null;
let currentVideoId = null;
let discoveryTimer = null;
let watching = false;

function getCurrentPlayer() {
  return document.querySelector('.html5-video-player');
}

function getCurrentVideo() {
  return document.querySelector('video');
}

function getPlayerVideoId(player) {
  try {
    const data = player && typeof player.getVideoData === 'function' && player.getVideoData();
    if (data && data.video_id) return data.video_id;
  } catch (e) {}
  const match = /[?&]v=([^&]+)/.exec(window.location.hash || '');
  return match ? match[1] : null;
}

function notify(kind, value, previous) {
  listeners[kind].slice().forEach((listener) => {
    try { listener(value, previous); }
    catch (e) { console.warn('[PlayerLifecycle] Listener failed:', e); }
  });
}

function refreshPlayerLifecycle() {
  const player = getCurrentPlayer();
  const video = getCurrentVideo();
  const videoId = getPlayerVideoId(player);
  const oldPlayer = currentPlayer;
  const oldVideo = currentVideo;
  const oldVideoId = currentVideoId;
  currentPlayer = player;
  currentVideo = video;
  currentVideoId = videoId;

  if (player !== oldPlayer) notify('player', player, oldPlayer);
  if (video !== oldVideo) notify('video', video, oldVideo);
  if (videoId !== oldVideoId) notify('videoId', videoId, oldVideoId);
}

function startWatching() {
  if (watching) return;
  watching = true;
  window.addEventListener('hashchange', refreshPlayerLifecycle);
  document.addEventListener('DOMContentLoaded', refreshPlayerLifecycle);
  discoveryTimer = setInterval(refreshPlayerLifecycle, DISCOVERY_INTERVAL_MS);
  refreshPlayerLifecycle();
}

function stopWatching() {
  if (!watching) return;
  watching = false;
  clearInterval(discoveryTimer);
  discoveryTimer = null;
  window.removeEventListener('hashchange', refreshPlayerLifecycle);
  document.removeEventListener('DOMContentLoaded', refreshPlayerLifecycle);
  currentPlayer = null;
  currentVideo = null;
  currentVideoId = null;
}

function subscribe(kind, listener) {
  if (typeof listener !== 'function') throw new TypeError('A lifecycle listener must be a function');
  // Refresh before adding this listener so it receives exactly one initial
  // snapshot, even when discovering a replacement also notifies older clients.
  startWatching();
  refreshPlayerLifecycle();
  listeners[kind].push(listener);
  const value = kind === 'player' ? currentPlayer : kind === 'video' ? currentVideo : currentVideoId;
  try { listener(value, null); }
  catch (e) { console.warn('[PlayerLifecycle] Listener failed:', e); }

  return function unsubscribe() {
    const index = listeners[kind].indexOf(listener);
    if (index !== -1) listeners[kind].splice(index, 1);
    if (!listeners.player.length && !listeners.video.length && !listeners.videoId.length) stopWatching();
  };
}

function watchPlayer(listener) { return subscribe('player', listener); }
function watchVideo(listener) { return subscribe('video', listener); }
function watchVideoId(listener) { return subscribe('videoId', listener); }

export {
  getCurrentPlayer, getCurrentVideo, getPlayerVideoId,
  refreshPlayerLifecycle, watchPlayer, watchVideo, watchVideoId,
};
