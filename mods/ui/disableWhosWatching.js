import { configChangeEmitter, configRead } from '../config.js';

let interval = null;

function clearPermanentInterval() {
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail;
    if (key === 'enableWhoIsWatchingMenu') {
        disableWhosWatching(value);
    } else if (key === 'permanentlyEnableWhoIsWatchingMenu') {
        disableWhosWatching(configRead('enableWhoIsWatchingMenu'));
    }
});

function disableWhosWatching(value) {
    if (!value) clearPermanentInterval();

    const raw = localStorage['yt.leanback.default::recurring_actions'];
    if (!raw) return;
    let LeanbackRecurringActions;
    try {
        LeanbackRecurringActions = JSON.parse(raw);
    } catch (e) {
        return;
    }

    const shouldPermanentlyEnable = configRead('permanentlyEnableWhoIsWatchingMenu');
    const data = LeanbackRecurringActions.data && LeanbackRecurringActions.data.data;
    if (!data) return;
    const startupAccountSelector = data["startup-screen-account-selector-with-guest"];
    const whosWatchingZeroAccounts = data.whos_watching_fullscreen_zero_accounts;
    const signedOutWelcomeBack = data["startup-screen-signed-out-welcome-back"];

    function writeActions(timestamp) {
        if (startupAccountSelector) startupAccountSelector.lastFired = timestamp;
        if (whosWatchingZeroAccounts) whosWatchingZeroAccounts.lastFired = timestamp;
        if (signedOutWelcomeBack) signedOutWelcomeBack.lastFired = timestamp;
        localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
    }

    if (!value) {
        clearPermanentInterval();
        const future = new Date();
        future.setDate(future.getDate() + 7);
        writeActions(future.getTime());
        return;
    }

    const now = Date.now();
    const lastFired = startupAccountSelector && startupAccountSelector.lastFired;
    if (lastFired && now - lastFired > 0 && now - lastFired < 2 * 60 * 60 * 1000 && !shouldPermanentlyEnable) {
        return;
    }

    clearPermanentInterval();
    if (shouldPermanentlyEnable) {
        const setPermanentActions = () => {
            const stale = new Date();
            stale.setDate(stale.getDate() - 7);
            writeActions(stale.getTime());
        };
        setPermanentActions();
        interval = setInterval(setPermanentActions, 60 * 1000);
    } else {
        writeActions(Date.now());
    }
}

disableWhosWatching(configRead('enableWhoIsWatchingMenu'));
