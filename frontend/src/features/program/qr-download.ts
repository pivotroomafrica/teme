/** Saves text (such as an SVG) as a file on the person's own device. Nothing is uploaded. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadSvg = (svg: string, filename: string) =>
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), filename);

/** Draws the SVG onto a canvas and returns it as a PNG, for printers and tools that want a bitmap. */
export function svgToPng(svg: string, size = 1200): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("No canvas"));
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      // Crisp squares: the code is made of hard edges.
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The code could not be drawn"));
    };
    image.src = url;
  });
}
