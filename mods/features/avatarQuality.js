// Channel and profile avatars. YouTube names the size in the URL (for example =s88 or =s48),
// and the TV draws them small. This asks for the 176px file instead. Only URLs and declared
// sizes in the response change, and an avatar is never made smaller.
export const AVATAR_TARGET_PX = 176;

const AVATAR_HOST = /(ggpht\.com|googleusercontent\.com)\//;
const SIZE_PARAM = /=s(\d+)/;

function upgradeAvatarEntry(entry) {
  if (!AVATAR_HOST.test(entry.url)) return;
  const match = SIZE_PARAM.exec(entry.url);
  if (!match) return;
  if (!(parseInt(match[1], 10) < AVATAR_TARGET_PX)) return;
  entry.url = entry.url.replace(SIZE_PARAM, "=s" + AVATAR_TARGET_PX);
  if (typeof entry.width === "number" && entry.width < AVATAR_TARGET_PX) entry.width = AVATAR_TARGET_PX;
  if (typeof entry.height === "number" && entry.height < AVATAR_TARGET_PX) entry.height = AVATAR_TARGET_PX;
}

function walkForAvatars(node, depth) {
  if (!node || typeof node !== "object" || depth > 60) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walkForAvatars(node[i], depth + 1);
    return;
  }
  if (typeof node.url === "string") upgradeAvatarEntry(node);
  for (const key in node) {
    if (Object.prototype.hasOwnProperty.call(node, key)) walkForAvatars(node[key], depth + 1);
  }
}

// Response filter. The text check skips the walk for responses with no avatar hosts at all.
export function filterAvatarQuality(result, text) {
  if (typeof text !== "string") return;
  if (text.indexOf("ggpht.com") === -1 && text.indexOf("googleusercontent.com") === -1) return;
  walkForAvatars(result, 0);
}
