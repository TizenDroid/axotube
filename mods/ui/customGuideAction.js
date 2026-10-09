import { configChangeEmitter, configRead } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";

// Registered after the AdBlock response filter in the shared JSON pipeline.
export function filterGuideItems(r) {
    if (!Array.isArray(r.items)) return;
    const disabledSidebarContents = configRead('disabledSidebarContents');
    const disableChannelsOnSidebar = configRead('disableChannelsOnSidebar');
    if (!disabledSidebarContents?.length && !disableChannelsOnSidebar) return;

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
