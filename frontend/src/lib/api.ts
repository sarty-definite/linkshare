import axios from 'axios';

export type RoomSummary = {
  id: string;
  isPrivate: boolean;
  lastActivity: string;
  createdAt: string;
  files: FileAsset[];
};

export type FileAsset = {
  id: string;
  roomId: string;
  originalName: string;
  safeName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  createdAt: string;
};

export type RoomStateResponse = {
  roomId: string;
  isPrivate: boolean;
  documentJson: unknown;
  documentVersion: number;
  lastActivityAt: string;
  presenceCount: number;
  files: FileAsset[];
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  withCredentials: true
});

export function getSocketUrl(): string {
  return import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
}

export async function createRoom(payload: { roomId: string; privateRoom: boolean; roomKey?: string }) {
  const response = await api.post('/api/rooms/create', payload);
  return response.data as { roomId: string; accessToken: string; isPrivate: boolean; createdAt: string };
}

export async function joinRoom(payload: { roomId: string; roomKey?: string }) {
  const response = await api.post('/api/rooms/join', payload);
  return response.data as { roomId: string; accessToken: string; isPrivate: boolean; createdAt: string };
}

export async function roomExists(roomId: string) {
  const response = await api.get(`/api/rooms/${encodeURIComponent(roomId)}/exists`);
  return response.data as { exists: boolean };
}

export async function fetchRoomState(roomId: string, token: string) {
  const response = await api.get<RoomStateResponse>(`/api/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return response.data;
}

export async function saveRoomContent(roomId: string, token: string, documentJson: unknown, clientVersion?: number) {
  const response = await api.post(
    `/api/rooms/${encodeURIComponent(roomId)}/content`,
    { documentJson, clientVersion },
    { headers: { authorization: `Bearer ${token}` } }
  );
  return response.data as { roomId: string; documentVersion: number; lastActivityAt: string };
}

export async function createUploadSession(roomId: string, token: string, payload: { fileName: string; mimeType: string; fileSize: number; chunkSize?: number }) {
  const response = await api.post(
    `/api/rooms/${encodeURIComponent(roomId)}/uploads`,
    payload,
    { headers: { authorization: `Bearer ${token}` } }
  );
  return response.data as { uploadId: string; chunkSize: number; totalChunks: number; expiresAt: string; presignedUrls?: string[] };
}

export async function uploadChunk(roomId: string, token: string, uploadId: string, chunkIndex: number, chunk: Blob) {
  const response = await api.put(
    `/api/rooms/${encodeURIComponent(roomId)}/uploads/${uploadId}/chunks/${chunkIndex}`,
    chunk,
    {
      headers: {
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream'
      }
    }
  );
  return response.data as { uploadId: string; chunkIndex: number; received: boolean };
}

export async function finalizeUpload(roomId: string, token: string, uploadId: string, parts?: { PartNumber: number; ETag: string }[]) {
  const response = await api.post(
    `/api/rooms/${encodeURIComponent(roomId)}/uploads/${uploadId}/finalize`,
    { parts },
    { headers: { authorization: `Bearer ${token}` } }
  );
  return response.data as { id: string; roomId: string; originalName: string; safeName: string; mimeType: string; size: number; storageKey: string; createdAt: string };
}

export async function getUploadStatus(roomId: string, token: string, uploadId: string) {
  const response = await api.get(
    `/api/rooms/${encodeURIComponent(roomId)}/uploads/${uploadId}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  return response.data as { uploadId: string; totalChunks: number; receivedChunks: number; status: string; expiresAt: string };
}

export async function getDownloadUrl(
  roomId: string,
  fileId: string,
  token: string
) {
  const response = await api.post(
    `/api/rooms/${encodeURIComponent(roomId)}/files/${fileId}/download-url`,
    {},
    { headers: { authorization: `Bearer ${token}` } }
  );

  return response.data.url as string;
}
