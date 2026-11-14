/** Capture only after an actual render; thumbnails are evidence of a visited viewpoint. */
export function captureView(source: HTMLCanvasElement): string | null {
  try {
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 320;
    thumbnail.height = 160;
    const ctx = thumbnail.getContext("2d");
    if (!ctx) return null;
    const cropHeight = Math.min(source.height, source.width / 2),
      cropWidth = cropHeight * 2;
    ctx.drawImage(
      source,
      (source.width - cropWidth) / 2,
      (source.height - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      320,
      160,
    );
    return thumbnail.toDataURL("image/jpeg", 0.76);
  } catch {
    return null;
  }
}
