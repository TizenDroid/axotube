// Keeps only the preferred video codec in adaptive formats when one is available.
// Audio formats are always kept.
export function applyStreamFormatFilter(r, preferredCodec) {
  if (!r || !r.streamingData || !r.streamingData.adaptiveFormats) return;
  if (!preferredCodec || preferredCodec === "any") return;
  const formats = r.streamingData.adaptiveFormats;
  const hasPreferredCodec = formats.find(
    (format) => format.mimeType && format.mimeType.includes(preferredCodec),
  );
  if (!hasPreferredCodec) return;
  r.streamingData.adaptiveFormats = formats.filter((format) => {
    if (format.mimeType && format.mimeType.startsWith("audio/")) return true;
    return format.mimeType && format.mimeType.includes(preferredCodec);
  });
}
