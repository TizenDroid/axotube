import { configRead, configChangeEmitter } from "../config.js";
import {
    getCurrentPlayer, getCurrentVideo, getPlayerVideoId,
    watchPlayer, watchVideo, watchVideoId,
} from "../shared/playerLifecycle.js";

let attachedPlayer = null;
let attachTimer = null;
let frameRateForced = false;
let resumeTimer = null;
let pendingResume = null;

function isWatchRoute() {
    return window.location.href.indexOf('watch') !== -1;
}

function getFrameRateApi() {
    return window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate;
}

function resetFrameRate() {
    if (!frameRateForced) return;
    const SetFrameRate = getFrameRateApi();
    if (!SetFrameRate) return;
    try {
        SetFrameRate.call(window.h5vcc.tizentube, 0);
        frameRateForced = false;
    } catch (e) {
        console.warn('Failed to reset auto frame rate:', e);
    }
}

function cancelPendingResume() {
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = null;
    if (pendingResume) {
        pendingResume.video.removeEventListener('play', cancelPendingResume);
        pendingResume = null;
    }
}

function detachFromVideoPlayer() {
    cancelPendingResume();
    if (attachTimer) {
        clearTimeout(attachTimer);
        attachTimer = null;
    }
    if (attachedPlayer) {
        try {
            attachedPlayer.removeEventListener('onPlaybackStartExternal', handlePlaybackStart);
        } catch (e) {}
        attachedPlayer = null;
    }
}

function handlePlaybackStart() {
    try {
        if (!isWatchRoute() || !attachedPlayer ||
            attachedPlayer !== getCurrentPlayer() || !configRead('autoFrameRate')) return;
        const statsForNerds = attachedPlayer.getStatsForNerds();
        const resolutionMatch = statsForNerds && statsForNerds.resolution
            ? statsForNerds.resolution.match(/(\d+)x(\d+)@([\d.]+)/)
            : null;
        const setFrameRate = getFrameRateApi();
        if (!resolutionMatch || !setFrameRate) return;

        const video = getCurrentVideo();
        const pauseFor = configRead('autoFrameRatePauseVideoFor');
        // Keep the pause around SetFrameRate, but only restore playback for
        // this exact player/video/route if the viewer has not intervened.
        const temporarilyPause = pauseFor > 0 && video && !video.paused && !pendingResume;
        if (temporarilyPause) video.pause();
        try {
            setFrameRate.call(window.h5vcc.tizentube, parseFloat(resolutionMatch[3]));
            frameRateForced = true;
        } finally {
            if (temporarilyPause && video.paused) {
                schedulePausedResume(video, attachedPlayer, pauseFor);
            }
        }
    } catch (e) {
        console.error('Error in auto frame rate handling:', e);
    }
}

function schedulePausedResume(video, player, delay) {
    // A pause was issued immediately before SetFrameRate. Capture its owner;
    // the timer must never query and play a newly loaded video.
    const hash = window.location.hash;
    const videoId = getPlayerVideoId(player);
    const source = video.currentSrc || video.src;
    pendingResume = { video, player, hash, videoId, source };
    video.addEventListener('play', cancelPendingResume);
    resumeTimer = setTimeout(() => {
        const pending = pendingResume;
        const shouldResume = pending && pending.video === video &&
            pending.player === attachedPlayer && getCurrentPlayer() === player &&
            getCurrentVideo() === video && isWatchRoute() &&
            configRead('autoFrameRate') && window.location.hash === hash &&
            getPlayerVideoId(player) === videoId &&
            (video.currentSrc || video.src) === source &&
            video.paused && !video.ended && !video.seeking;
        cancelPendingResume();
        if (!shouldResume) return;
        try {
            const playback = video.play();
            if (playback && typeof playback.catch === 'function') playback.catch(() => {});
        } catch (e) {
            console.warn('Failed to resume after frame rate switch:', e);
        }
    }, delay);
}

function attachToVideoPlayer() {
    if (attachTimer) {
        clearTimeout(attachTimer);
        attachTimer = null;
    }

    if (!configRead("autoFrameRate")) {
        detachFromVideoPlayer();
        resetFrameRate();
        return;
    }

    const player = getCurrentPlayer();
    if (!player) {
        attachTimer = setTimeout(attachToVideoPlayer, 500);
        return;
    }
    if (player === attachedPlayer) return;

    cancelPendingResume();
    if (attachedPlayer) {
        try {
            attachedPlayer.removeEventListener('onPlaybackStartExternal', handlePlaybackStart);
        } catch (e) {}
    }
    attachedPlayer = player;
    attachedPlayer.addEventListener('onPlaybackStartExternal', handlePlaybackStart);
}

window.addEventListener('hashchange', () => {
    cancelPendingResume();
    if (!isWatchRoute()) resetFrameRate();
    // YouTube can replace the player node during route changes.
    setTimeout(attachToVideoPlayer, 0);
});

// No mutation observer is needed: the shared watcher discovers replaced
// player/media nodes, while the existing 500ms retry handles initial readiness.
watchPlayer((player) => {
    if (player !== attachedPlayer) attachToVideoPlayer();
});
watchVideo((video, oldVideo) => {
    if (oldVideo && video !== oldVideo) cancelPendingResume();
});
watchVideoId((id, oldId) => {
    if (oldId && id !== oldId) cancelPendingResume();
});

// A remote button or interaction during AFR's brief pause is a new user
// intent. Err on the side of leaving playback paused.
document.addEventListener('keydown', cancelPendingResume, true);
document.addEventListener('mousedown', cancelPendingResume, true);
document.addEventListener('touchstart', cancelPendingResume, true);

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail?.key === "autoFrameRate") {
        if (event.detail.value) {
            attachToVideoPlayer();
        } else {
            detachFromVideoPlayer();
            resetFrameRate();
        }
    } else if (event.detail?.key === 'autoFrameRatePauseVideoFor') {
        cancelPendingResume();
    }
});

attachToVideoPlayer();
