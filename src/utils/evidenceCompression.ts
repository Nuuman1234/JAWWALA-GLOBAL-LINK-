export interface CompressedEvidence {
  base64Data: string;
  fileName: string;
  sizeBytes: number;
  sha256Hash: string;
}

const MAX_BASE64_LENGTH = 330000;

async function computeSha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected evidence file.'));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1280;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable for image compression.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.78;
      let out = canvas.toDataURL('image/jpeg', quality);
      while (out.length > MAX_BASE64_LENGTH && quality > 0.35) {
        quality -= 0.1;
        out = canvas.toDataURL('image/jpeg', quality);
      }

      if (out.length > MAX_BASE64_LENGTH) {
        const halfCanvas = document.createElement('canvas');
        halfCanvas.width = Math.max(1, Math.round(width * 0.65));
        halfCanvas.height = Math.max(1, Math.round(height * 0.65));
        const hCtx = halfCanvas.getContext('2d');
        if (hCtx) {
          hCtx.fillStyle = '#ffffff';
          hCtx.fillRect(0, 0, halfCanvas.width, halfCanvas.height);
          hCtx.drawImage(canvas, 0, 0, halfCanvas.width, halfCanvas.height);
          out = halfCanvas.toDataURL('image/jpeg', 0.65);
        }
      }

      resolve(out);
    };
    img.onerror = () => reject(new Error('Selected image could not be decoded.'));
    img.src = dataUrl;
  });
}

export async function processEvidenceFile(file: File): Promise<CompressedEvidence> {
  const safeName = file.name.trim().slice(0, 110) || 'evidence';
  const rawUrl = await readFileAsDataUrl(file);

  let finalDataUrl = rawUrl;
  if (file.type.startsWith('image/')) {
    finalDataUrl = await compressImageDataUrl(rawUrl);
  } else if (rawUrl.length > MAX_BASE64_LENGTH) {
    throw new Error(
      'Document exceeds low-bandwidth limit (~240KB). Upload a compressed photo or smaller PDF.'
    );
  }

  if (finalDataUrl.length > MAX_BASE64_LENGTH) {
    throw new Error('Compressed evidence still exceeds the 330KB Firestore document budget.');
  }

  const sha256Hash = await computeSha256Hex(finalDataUrl);
  return {
    base64Data: finalDataUrl,
    fileName: safeName,
    sizeBytes: finalDataUrl.length,
    sha256Hash,
  };
}
