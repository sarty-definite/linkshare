import { io, type Socket } from "socket.io-client";
import { getSocketUrl } from "./api";

export function createRoomSocket(roomId: string, token: string): Socket {
  return io(getSocketUrl(), {
    transports: ["websocket"],
    auth: { roomId, token },
  });
}
