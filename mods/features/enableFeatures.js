// Enable features that aren't enabled by default due to YT seeing the TV as a low-end device
import { configRead, configChangeEmitter } from '../config.js';

let retryTimer = null;

configChangeEmitter.addEventListener('configChange', () => {
    enableFeatures();
});

function enableFeatures() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    if (!window._yttv) {
        retryTimer = setTimeout(enableFeatures, 250);
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
        // _yttv is created before all service maps are populated on some builds.
        // Keep waiting for the capability we actually need instead of latching early.
        retryTimer = setTimeout(enableFeatures, 250);
        return;
    }

    featureMap.set("ENABLE_PREVIEWS_WITH_SOUND", configRead('enablePreviews'));
}

if (document.readyState === 'complete') {
    enableFeatures();
} else {
    window.addEventListener('load', enableFeatures);
}
