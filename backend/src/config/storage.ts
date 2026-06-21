import fs from "node:fs";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "./env.js";
import type { Readable } from "node:stream";

export type StoredObject = {
  key: string;
  mimeType: string;
};

type ObjectStream = Readable;

export interface StorageAdapter {
  saveFile(sourcePath: string, object: StoredObject): Promise<void>;
  deleteFile(key: string): Promise<void>;
  createReadStream(key: string): Promise<ObjectStream>;

  createDownloadUrl?(
    key: string,
    fileName: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

const localRoot = path.resolve(env.LOCAL_STORAGE_DIR);
fs.mkdirSync(localRoot, { recursive: true });

const s3Client =
  env.STORAGE_PROVIDER === "s3"
    ? new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        requestChecksumCalculation: "WHEN_REQUIRED",
        credentials:
          env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: env.S3_ACCESS_KEY_ID,
                secretAccessKey: env.S3_SECRET_ACCESS_KEY,
              }
            : undefined,
      })
    : null;

const localStorage: StorageAdapter = {
  async saveFile(sourcePath, object) {
    const destinationPath = path.join(
      localRoot,
      object.key.replaceAll("/", path.sep),
    );
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    await fs.promises.copyFile(sourcePath, destinationPath);
  },
  async deleteFile(key) {
    const destinationPath = path.join(localRoot, key.replaceAll("/", path.sep));
    await fs.promises.rm(destinationPath, { force: true });
  },
  async createReadStream(key) {
    const destinationPath = path.join(localRoot, key.replaceAll("/", path.sep));
    return fs.createReadStream(destinationPath);
  },
};

const s3Storage: StorageAdapter = {
  async saveFile(sourcePath, object) {
    if (!s3Client || !env.S3_BUCKET) {
      throw new Error("S3 storage is not configured");
    }
    const body = fs.createReadStream(sourcePath);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: object.key,
        Body: body,
        ContentType: object.mimeType,
      }),
    );
  },
  async deleteFile(key) {
    if (!s3Client || !env.S3_BUCKET) {
      throw new Error("S3 storage is not configured");
    }
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
  },
  async createReadStream(key) {
    if (!s3Client || !env.S3_BUCKET) {
      throw new Error("S3 storage is not configured");
    }
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
    );
    if (
      !response.Body ||
      typeof (response.Body as NodeJS.ReadableStream).pipe !== "function"
    ) {
      throw new Error("Unexpected S3 response body");
    }
    return response.Body as Readable;
  },
};

const r2Client =
  env.STORAGE_PROVIDER === "r2"
    ? new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        requestChecksumCalculation: "WHEN_REQUIRED",
        credentials:
          env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
            ? {
                accessKeyId: env.R2_ACCESS_KEY_ID,
                secretAccessKey: env.R2_SECRET_ACCESS_KEY,
              }
            : undefined,
      })
    : null;

const r2Storage: StorageAdapter = {
  async saveFile(sourcePath, object) {
    if (!r2Client || !env.R2_BUCKET) {
      throw new Error("R2 storage is not configured");
    }
    const body = fs.createReadStream(sourcePath);
    await r2Client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: object.key,
        Body: body,
        ContentType: object.mimeType,
      }),
    );
  },
  async deleteFile(key) {
    if (!r2Client || !env.R2_BUCKET) {
      throw new Error("R2 storage is not configured");
    }
    await r2Client.send(
      new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    );
  },
  async createReadStream(key) {
    if (!r2Client || !env.R2_BUCKET) {
      throw new Error("R2 storage is not configured");
    }
    const response = await r2Client.send(
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
      }),
    );
    if (
      !response.Body ||
      typeof (response.Body as NodeJS.ReadableStream).pipe !== "function"
    ) {
      throw new Error("Unexpected R2 response body");
    }
    return response.Body as Readable;
  },
};

export const storage =
  env.STORAGE_PROVIDER === "s3"
    ? s3Storage
    : env.STORAGE_PROVIDER === "r2"
      ? r2Storage
      : localStorage;

export function getActiveS3Client(): {
  client: S3Client | null;
  bucket: string | undefined;
} {
  if (env.STORAGE_PROVIDER === "s3") {
    return { client: s3Client, bucket: env.S3_BUCKET };
  }
  if (env.STORAGE_PROVIDER === "r2") {
    return { client: r2Client, bucket: env.R2_BUCKET };
  }
  return { client: null, bucket: undefined };
}
