import sanitizeFilename from 'sanitize-filename';

export function normalizeRoomId(roomId: string) {
  return roomId.trim();
}

export function isValidRoomId(roomId: string) {
  return /^[a-zA-Z0-9_-]{3,64}$/.test(roomId);
}

export function sanitizeUploadName(fileName: string) {
  const base = sanitizeFilename(fileName) || 'file';
  return base.replace(/\s+/g, '-');
}

export function buildStorageKey(roomId: string, fileId: string, safeName: string) {
  return `${roomId}/${fileId}/${safeName}`;
}
