import { configRead, configChangeEmitter } from "../config.js";

let attachedPlayer = null;
let attachTimer = null;
let frameRateForced = false;

function isWatchRoute() {
    return window.location.href.indexOf('watch') !== -1;
}

function getFrameRateApi() {
    return window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate;
}

function resetFrameRate() {
    if (!frameRateForced) return;
    const setFrameRate = getFrameRateApi();
    if (!setFrameRate) return;
    try {
        setFrameRate.call(window.h5vcc.tizentube, 0);
        frameRateForced = false;
    } catch (e) {
        console.warn('Failed to reset auto frame rate:', e);
    }
}

function detachFromVideoPlayer() {
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
        if (!isWatchRoute() || !attachedPlayer || !configRead('autoFrameRate')) return;
        const statsForNerds = attachedPlayer.getStatsForNerds();
        const resolutionMatch = statsForNerds && statsForNerds.resolution
            ? statsForNerds.resolution.match(/(\d+)x(\d+)@([\d.]+)/)
            : null;
        const setFrameRate = getFrameRateApi();
        if (!resolutionMatch || !setFrameRate) return;

        const video = document.querySelector('video');
        const pauseFor = configRead('autoFrameRatePauseVideoFor');
        if (pauseFor > 0 && video) {
            video.pause();
            setTimeout(() => {
                const currentVideo = document.querySelector('video');
                if (currentVideo) currentVideo.play();
            }, pauseFor);
        }
        setFrameRate.call(window.h5vcc.tizentube, parseFloat(resolutionMatch[3]));
        frameRateForced = true;
    } catch (e) {
        console.error('Error in auto frame rate handling:', e);
    }
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

    const player = document.querySelector('.html5-video-player');
    if (!player) {
        attachTimer = setTimeout(attachToVideoPlayer, 500);
        return;
    }
    if (player === attachedPlayer) return;

    if (attachedPlayer) {
        try {
            attachedPlayer.removeEventListener('onPlaybackStartExternal', handlePlaybackStart);
        } catch (e) {}
    }
    attachedPlayer = player;
    attachedPlayer.addEventListener('onPlaybackStartExternal', handlePlaybackStart);
}

window.addEventListener('hashchange', () => {
    if (!isWatchRoute()) resetFrameRate();
    // YouTube can replace the player node during route changes.
    setTimeout(attachToVideoPlayer, 0);
});

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail?.key !== "autoFrameRate") return;
    if (event.detail.value) {
        attachToVideoPlayer();
    } else {
        detachFromVideoPlayer();
        resetFrameRate();
    }
});

attachToVideoPlayer();
