import * as Y from 'yjs';
import { RoomRepository } from '../repositories/room.repository.js';

export class YjsRoomManager {
  private static activeDocs = new Map<string, Y.Doc>();

  /**
   * Gets an existing in-memory Y.Doc for a room or creates one.
   */
  static getOrCreateDoc(roomId: string): Y.Doc {
    let doc = this.activeDocs.get(roomId);
    if (!doc) {
      doc = new Y.Doc();
      this.activeDocs.set(roomId, doc);
    }
    return doc;
  }

  /**
   * Checks if an active Y.Doc is cached for a room.
   */
  static hasDoc(roomId: string): boolean {
    return this.activeDocs.has(roomId);
  }

  /**
   * Removes a cached Y.Doc from memory.
   */
  static removeDoc(roomId: string): void {
    this.activeDocs.delete(roomId);
  }

  /**
   * Deserializes a base64 string into a Y.Doc instance.
   */
  static deserializeState(base64State: string): Y.Doc {
    const doc = new Y.Doc();
    const binary = Buffer.from(base64State, 'base64');
    Y.applyUpdate(doc, binary);
    return doc;
  }

  /**
   * Serializes a Y.Doc instance into a base64 string.
   */
  static serializeState(doc: Y.Doc): string {
    const binary = Y.encodeStateAsUpdate(doc);
    return Buffer.from(binary).toString('base64');
  }

  /**
   * Loads a room's state from the database.
   * If the room has legacy JSON content, it initializes an empty Y.Doc.
   */
  static async loadRoom(roomId: string, documentJson: any): Promise<Y.Doc> {
    let doc = this.activeDocs.get(roomId);
    if (doc) {
      return doc;
    }

    doc = new Y.Doc();
    
    // Check if the database contains a serialized Yjs state
    if (
      documentJson &&
      typeof documentJson === 'object' &&
      documentJson.type === 'yjs' &&
      typeof documentJson.state === 'string'
    ) {
      const binary = Buffer.from(documentJson.state, 'base64');
      Y.applyUpdate(doc, binary);
    }
    
    this.activeDocs.set(roomId, doc);
    return doc;
  }

  /**
   * Persists the current in-memory Y.Doc state to the database.
   */
  static async persistRoom(roomId: string): Promise<void> {
    const doc = this.activeDocs.get(roomId);
    if (!doc) return;

    const base64 = this.serializeState(doc);
    await RoomRepository.update(roomId, {
      documentJson: {
        type: 'yjs',
        state: base64
      },
      lastActivityAt: new Date()
    });
  }

  private static persistTimeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Schedules a debounced persistence task for a room (e.g. saves every 5 seconds of activity).
   */
  static debouncedPersist(roomId: string): void {
    const existing = this.persistTimeouts.get(roomId);
    if (existing) {
      clearTimeout(existing);
    }
    const timeout = setTimeout(async () => {
      this.persistTimeouts.delete(roomId);
      await this.persistRoom(roomId).catch(() => undefined);
    }, 5000);
    this.persistTimeouts.set(roomId, timeout);
  }

  /**
   * Force persists the room state immediately and cleans up from memory.
   */
  static async forcePersistAndCleanup(roomId: string): Promise<void> {
    const timeout = this.persistTimeouts.get(roomId);
    if (timeout) {
      clearTimeout(timeout);
      this.persistTimeouts.delete(roomId);
    }
    await this.persistRoom(roomId).catch(() => undefined);
    this.removeDoc(roomId);
  }
}
