function safeGetInstance(candidate) {
    try {
        if (!candidate || typeof candidate.getInstance !== 'function') return null;
        return candidate.getInstance() || null;
    } catch (e) {
        return null;
    }
}

function findRouterMethod(instance) {
    if (!instance) return null;
    try {
        const proto = Object.getPrototypeOf(instance);
        if (!proto) return null;
        const keys = Object.getOwnPropertyNames(proto);
        for (const key of keys) {
            let value;
            try { value = instance[key]; } catch (e) { continue; }
            if (typeof value === 'function') {
                try {
                    if (value.toString().includes('ytlrActionRouter')) return value;
                } catch (e) {}
            }
        }
    } catch (e) {}
    return null;
}

function getCommandExecutor() {
    if (!window._yttv) return;
    let instance = null;
    let executeFunction = null;

    try {
        for (const key in window._yttv) {
            let candidate;
            try { candidate = window._yttv[key]; } catch (e) { continue; }
            if (!candidate || typeof candidate.getInstance !== 'function') continue;

            const tempInstance = safeGetInstance(candidate);
            if (!tempInstance) continue;

            try {
                if (candidate.toString().includes('ytlrActionRouter')) {
                    instance = tempInstance;
                    executeFunction = findRouterMethod(instance);
                    break;
                }
            } catch (e) {}

            const router = findRouterMethod(tempInstance);
            if (router) {
                instance = tempInstance;
                executeFunction = router;
                break;
            }
        }
    } catch (e) {
        return;
    }

    if (!instance || !executeFunction) return;

    let commandFunction = null;
    try {
        for (const key in window._yttv) {
            let candidate;
            try { candidate = window._yttv[key]; } catch (e) { continue; }
            if (typeof candidate !== 'function') continue;
            try {
                if (candidate.toString().includes('this.actionName')) {
                    commandFunction = candidate;
                    break;
                }
            } catch (e) {}
        }
    } catch (e) {}

    if (!commandFunction) return;
    return {
        executeFunction: executeFunction.bind(instance),
        commandFunction
    };
}

export default getCommandExecutor;