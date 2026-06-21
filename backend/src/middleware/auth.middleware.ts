import type { Request } from "express";
import { RoomRepository } from "../repositories/room.repository.js";
import { verifyAccessToken } from "../utils/security.util.js";

export function getBearerToken(req: Request): string {
  const header = req.get("authorization");
  if (!header) {
    throw new Error("Missing authorization header");
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new Error("Invalid authorization header");
  }
  return token;
}

export async function requireRoomAuth(req: Request, expectedRoomId?: string) {
  const token = getBearerToken(req);
  const tokenRoomId = verifyAccessToken(token);
  if (expectedRoomId && tokenRoomId !== expectedRoomId) {
    throw new Error("Room token does not match the requested room");
  }
  const room = await RoomRepository.findById(tokenRoomId);
  if (!room) {
    throw new Error("Room no longer exists");
  }
  return room;
}
