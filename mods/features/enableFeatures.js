// Enable features that aren't enabled by default due to YT seeing the TV as a low-end device
import { configRead, configChangeEmitter } from '../config.js';

let retryTimer = null;
let retryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 20;
const RETRY_DELAY_MS = 500;

configChangeEmitter.addEventListener('configChange', () => {
    enableFeatures(true);
});

function scheduleRetry() {
    if (retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    retryAttempts += 1;
    retryTimer = setTimeout(() => enableFeatures(false), RETRY_DELAY_MS);
}

function enableFeatures(resetRetryBudget = false) {
    if (resetRetryBudget) retryAttempts = 0;

    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    if (!window._yttv) {
        scheduleRetry();
        return;
    }

    let featureMap = null;
    try {
        featureMap = Object.values(window._yttv).find(
            a => a instanceof Map && a.has("ENABLE_PREVIEWS_WITH_SOUND")
        );
    } catch (e) {
        featureMap = null;
    }

    if (!featureMap) {
        scheduleRetry();
        return;
    }

    retryAttempts = 0;
    featureMap.set("ENABLE_PREVIEWS_WITH_SOUND", configRead('enablePreviews'));
}

if (document.readyState === 'complete') {
    enableFeatures(true);
} else {
    window.addEventListener('load', () => enableFeatures(true));
}
