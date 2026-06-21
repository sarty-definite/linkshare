import type { Request, Response, NextFunction } from "express";
import { DownloadService } from "../services/download.service.js";
import { requireRoomAuth } from "../middleware/auth.middleware.js";
import { normalizeRoomId } from "../utils/path.util.js";

export class DownloadController {
  static async getUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params["roomId"] || ""));
      const room = await requireRoomAuth(req, roomId);
      const fileId = String(req.params["fileId"] || "");

      const url = await DownloadService.generateDownloadUrl(room.id, fileId);
      res.json({ url });
    } catch (error) {
      next(error);
    }
  }

  static async downloadDirect(req: Request, res: Response, next: NextFunction) {
    try {
      const roomId = normalizeRoomId(String(req.params["roomId"] || ""));
      const room = await requireRoomAuth(req, roomId);
      const fileId = String(req.params["fileId"] || "");

      const { file, stream } = await DownloadService.getFileForRoom(
        room.id,
        fileId,
      );

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      stream.on("error", next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  }

  static async downloadByToken(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const token = String(req.params.token || "");
      const { file, stream } = await DownloadService.getFileByToken(token);

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      stream.on("error", next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  }
}
