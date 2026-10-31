// Long-press peek. A long press shows a large title and thumbnail for the video.
// This swaps each one for the other version, the one not currently on the grid:
//   DeArrow title on, peek shows the original title; DeArrow title off, peek shows
//   the DeArrow title. The same rule applies to thumbnails, field by field.
// If the other version is not known yet (the DeArrow data is still loading), the
// menu is left as it is.
import { configRead } from "../config.js";
import {
  deArrowTitleFor,
  deArrowThumbnailsFor,
  getDeArrowData,
  getOriginalTile,
} from "./deArrow.js";

export function applyDeArrowPeek(cmd) {
  if (!configRead("enableDeArrowPeek")) return;
  const menu = cmd && cmd.showMenuCommand;
  if (!menu || !menu.contentId) return;

  const original = getOriginalTile(menu.contentId);
  const data = getDeArrowData(menu.contentId);
  if (!original || !data) return;

  if (menu.title) {
    const titleOn = !!configRead("enableDeArrowTitles");
    const other = titleOn ? original.title : deArrowTitleFor(data);
    if (other) menu.title = { simpleText: other };
  }

  if (menu.thumbnail) {
    const thumbnailOn = !!configRead("enableDeArrowThumbnails");
    const other = thumbnailOn ? original.thumbnails : deArrowThumbnailsFor(menu.contentId, data);
    if (other) menu.thumbnail = { thumbnails: other };
  }
}
