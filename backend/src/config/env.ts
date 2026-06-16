import path from 'node:path';
import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().min(1),
  API_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default(path.join(process.cwd(), 'uploads')),
  UPLOAD_TMP_DIR: z.string().default(path.join(process.cwd(), 'uploads', 'tmp')),
  ROOM_CLEANUP_MINUTES: z.coerce.number().int().positive().default(30),
  FILE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(250 * 1024 * 1024),
  ROOM_MAX_SESSIONS: z.coerce.number().int().positive().default(10),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false)
});

export const env = envSchema.parse(process.env);
