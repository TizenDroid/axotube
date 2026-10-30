// Formats the on-screen clock. Kept free of DOM and config so it can be tested.
//   "24h"        14:05
//   "12h"        2:05 PM      (12-hour with AM/PM)
//   "12hNoAmPm"  2:05         (12-hour, no AM/PM)
function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

export function formatClock(date, format, showSeconds) {
  const minutes = pad(date.getMinutes());
  const seconds = showSeconds ? ":" + pad(date.getSeconds()) : "";
  const hours24 = date.getHours();

  if (format === "24h") return pad(hours24) + ":" + minutes + seconds;

  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const text = String(hours12) + ":" + minutes + seconds;
  if (format === "12hNoAmPm") return text;
  return text + (hours24 < 12 ? " AM" : " PM");
}
