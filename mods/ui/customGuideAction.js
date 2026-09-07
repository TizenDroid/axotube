import { configChangeEmitter, configRead } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";

const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);

    try {
        const disabledSidebarContents = configRead('disabledSidebarContents');
        const disableChannelsOnSidebar = configRead('disableChannelsOnSidebar');
        if (r && Array.isArray(r.items)) {
            for (let i = 0; i < r.items.length; i++) {
                const section = r.items[i] && r.items[i].guideSectionRenderer;
                if (!section || !Array.isArray(section.items)) continue;
                for (let j = 0; j < section.items.length; j++) {
                    const item = section.items[j] && section.items[j].guideEntryRenderer;
                    if (!item) continue;
                    if ((disabledSidebarContents?.length && disabledSidebarContents.includes(item.icon?.iconType))
                        || (disableChannelsOnSidebar && item?.thumbnail)) {
                        section.items.splice(j, 1);
                        j--;
                    }
                }
            }
        }
    } catch (err) {
        // JSON.parse must never fail because a YouTube response shape changed.
    }

    return r;
}

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail.key === 'disabledSidebarContents' || e.detail.key === 'disableChannelsOnSidebar') {
        try {
            const commandExecutor = getCommandExecutor();
            if (commandExecutor) {
                commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
            }
        } catch (err) {
            console.warn('Guide reload failed:', err);
        }
    }
});
