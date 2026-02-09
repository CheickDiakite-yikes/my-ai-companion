import { Client as ReplitObjectStorageClient } from "@replit/object-storage";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join, normalize } from "path";

export type StorageProvider = "replit" | "local";

type DriverMode = "auto" | "replit" | "local";

export interface MediaUploadInput {
  objectKey: string;
  bytes: Buffer;
}

export interface MediaDownloadInput {
  provider: StorageProvider;
  objectKey: string;
}

export interface MediaDeleteInput {
  provider: StorageProvider;
  objectKey: string;
}

export interface MediaUploadResult {
  provider: StorageProvider;
  objectKey: string;
}

export interface MediaStore {
  mode: DriverMode;
  uploadObject(input: MediaUploadInput): Promise<MediaUploadResult>;
  downloadObject(input: MediaDownloadInput): Promise<Buffer>;
  deleteObject(input: MediaDeleteInput): Promise<void>;
}

function resolveDriverMode(): DriverMode {
  const mode = (process.env.MEDIA_STORAGE_DRIVER ?? "auto").toLowerCase();
  if (mode === "replit" || mode === "local" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function getLocalRoot(): string {
  return process.env.MEDIA_LOCAL_DIR ?? "/tmp/my-ai-companion-media";
}

function sanitizeKey(objectKey: string): string {
  const normalized = normalize(objectKey).replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid object key");
  }
  return normalized;
}

class LocalDiskStore {
  private readonly rootDir = getLocalRoot();

  private resolvePath(objectKey: string): string {
    return join(this.rootDir, sanitizeKey(objectKey));
  }

  async uploadObject(input: MediaUploadInput): Promise<MediaUploadResult> {
    const targetPath = this.resolvePath(input.objectKey);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.bytes);
    return {
      provider: "local",
      objectKey: sanitizeKey(input.objectKey),
    };
  }

  async downloadObject(objectKey: string): Promise<Buffer> {
    const targetPath = this.resolvePath(objectKey);
    return readFile(targetPath);
  }

  async deleteObject(objectKey: string): Promise<void> {
    const targetPath = this.resolvePath(objectKey);
    await rm(targetPath, { force: true });
  }
}

class ReplitBucketStore {
  private readonly client: ReplitObjectStorageClient;

  constructor() {
    const bucketId = process.env.MEDIA_REPLIT_BUCKET_ID;
    this.client = new ReplitObjectStorageClient(
      bucketId ? { bucketId } : undefined,
    );
  }

  async uploadObject(input: MediaUploadInput): Promise<MediaUploadResult> {
    const result = await this.client.uploadFromBytes(
      sanitizeKey(input.objectKey),
      input.bytes,
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return {
      provider: "replit",
      objectKey: sanitizeKey(input.objectKey),
    };
  }

  async downloadObject(objectKey: string): Promise<Buffer> {
    const result = await this.client.downloadAsBytes(sanitizeKey(objectKey));
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const [bytes] = result.value;
    return Buffer.from(bytes);
  }

  async deleteObject(objectKey: string): Promise<void> {
    const result = await this.client.delete(sanitizeKey(objectKey), {
      ignoreNotFound: true,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  }
}

class ConfigurableMediaStore implements MediaStore {
  readonly mode: DriverMode;

  private readonly localStore = new LocalDiskStore();
  private replitStore: ReplitBucketStore | null = null;

  constructor(mode: DriverMode) {
    this.mode = mode;
  }

  private getReplitStore(): ReplitBucketStore {
    if (!this.replitStore) {
      this.replitStore = new ReplitBucketStore();
    }
    return this.replitStore;
  }

  async uploadObject(input: MediaUploadInput): Promise<MediaUploadResult> {
    if (this.mode === "local") {
      return this.localStore.uploadObject(input);
    }
    if (this.mode === "replit") {
      return this.getReplitStore().uploadObject(input);
    }

    try {
      return await this.getReplitStore().uploadObject(input);
    } catch {
      return this.localStore.uploadObject(input);
    }
  }

  async downloadObject(input: MediaDownloadInput): Promise<Buffer> {
    if (input.provider === "replit") {
      return this.getReplitStore().downloadObject(input.objectKey);
    }
    return this.localStore.downloadObject(input.objectKey);
  }

  async deleteObject(input: MediaDeleteInput): Promise<void> {
    if (input.provider === "replit") {
      await this.getReplitStore().deleteObject(input.objectKey);
      return;
    }
    await this.localStore.deleteObject(input.objectKey);
  }
}

let mediaStoreSingleton: MediaStore | null = null;

export function getMediaStore(): MediaStore {
  if (!mediaStoreSingleton) {
    mediaStoreSingleton = new ConfigurableMediaStore(resolveDriverMode());
  }
  return mediaStoreSingleton;
}
