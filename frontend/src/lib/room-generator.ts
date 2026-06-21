import { roomExists } from "./api";
import { adjectives, nouns } from "../config/word-lists";

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function generateInstantRoomId(): Promise<string> {
  const maxRetries = 5;
  let candidate = "";

  for (let i = 0; i < maxRetries; i++) {
    const adjective = getRandomElement(adjectives);
    const noun = getRandomElement(nouns);
    const num = getRandomNumber(10, 99);
    candidate = `${adjective}-${noun}-${num}`;

    try {
      const res = await roomExists(candidate);
      if (!res.exists) {
        return candidate;
      }
    } catch {
      // If the API check fails (e.g. offline/network issue), proceed with the generated candidate
      return candidate;
    }
  }

  // Fallback in case of persistent collisions (e.g., highly congested room space)
  return `${candidate}-${Date.now().toString().slice(-4)}`;
}
