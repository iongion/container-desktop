// Uploaded-image handling for custom avatars. Runs in the renderer — canvas is a browser API and MUST NOT leak
// into @/ai-system/core. Drawing to a canvas also strips any script embedded in an uploaded SVG: only pixels
// survive, so a hostile SVG becomes an inert raster.

// Fit (width, height) into a max square, preserving aspect ratio and never upscaling. Pure — unit-tested.
export function fitDimensions(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Rasterize an uploaded image file to a small WebP data URL (~128px longest side).
export async function downscaleToWebP(file: File, max = 128): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitDimensions(bitmap.width, bitmap.height, max);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("AI: canvas is unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    bitmap.close();
  }
}
