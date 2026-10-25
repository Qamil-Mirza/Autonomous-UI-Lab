import { crc32, inflateRawSync } from "node:zlib";
import { ImportError } from "./errors";

/** Hard limits for an uploaded archive. Everything in it is untrusted until these pass. */
export interface ZipLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxPathLength: number;
  maxPathDepth: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 5000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxPathLength: 240,
  maxPathDepth: 24,
};

export interface ZipFile {
  /** Normalized relative path with `/` separators. */
  path: string;
  data: Buffer;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const UNIX_HOST = 3;

const malformed = (why: string) =>
  new ImportError("ARCHIVE_MALFORMED", `The ZIP file is damaged or not a ZIP: ${why}.`, "Export the code again from Figma Make and upload the new ZIP.");

/**
 * Rejects every path that could escape the extraction root or alias another file: absolute paths, drive letters,
 * backslashes, `.`/`..`/empty segments, control characters, and over-long or over-deep paths.
 */
export function safeRelativePath(raw: string, limits: Pick<ZipLimits, "maxPathLength" | "maxPathDepth"> = DEFAULT_ZIP_LIMITS): string {
  const unsafe = (why: string) =>
    new ImportError("ARCHIVE_UNSAFE_PATH", `The ZIP contains an unsafe path ${JSON.stringify(raw.slice(0, 120))}: ${why}.`, "Remove that file and export again.");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw unsafe("control characters");
  if (raw.includes("\\")) throw unsafe("backslash separators");
  if (raw.startsWith("/")) throw unsafe("absolute path");
  if (/^[A-Za-z]:/.test(raw)) throw unsafe("drive letter");
  const path = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (!path) throw unsafe("empty path");
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) throw unsafe("empty, '.' or '..' segment");
  if (path.length > limits.maxPathLength) throw unsafe(`longer than ${limits.maxPathLength} characters`);
  if (segments.length > limits.maxPathDepth) throw unsafe(`deeper than ${limits.maxPathDepth} directories`);
  return path.normalize("NFC");
}

interface CentralEntry {
  name: string;
  isDir: boolean;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/**
 * Reads a ZIP from memory with no extraction to disk. Only stored and deflated, unencrypted, non-ZIP64 archives
 * are accepted; symlinks and special files are rejected; declared and actual sizes, CRCs and local headers must
 * agree; data ranges must not overlap (a common bomb technique); inflation is capped at the declared size.
 */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipFile[] {
  if (buf.length > limits.maxArchiveBytes) {
    throw new ImportError("ARCHIVE_TOO_LARGE", `The ZIP is ${mb(buf.length)}; the limit is ${mb(limits.maxArchiveBytes)}.`, "Remove large assets (videos, unused images) and export again.");
  }
  if (buf.length < 22) throw malformed("too short");

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw malformed("no end-of-archive record");
  const diskNo = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ImportError("ARCHIVE_UNSUPPORTED", "ZIP64 archives are not supported.", "Exports from Figma Make are small; re-export or re-zip with a standard ZIP tool.");
  }
  if (diskNo !== 0 || cdDisk !== 0 || entriesOnDisk !== total) {
    throw new ImportError("ARCHIVE_UNSUPPORTED", "Multi-part (spanned) ZIP archives are not supported.");
  }
  if (total > limits.maxEntries) {
    throw new ImportError("ARCHIVE_TOO_MANY_FILES", `The ZIP has ${total} entries; the limit is ${limits.maxEntries}.`, "Do not include node_modules or build output in the ZIP.");
  }
  if (cdOffset + cdSize > eocd) throw malformed("central directory overlaps the end record");

  const entries: CentralEntry[] = [];
  let p = cdOffset;
  let declaredTotal = 0;
  for (let i = 0; i < total; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CENTRAL) throw malformed("bad central directory entry");
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const diskStart = buf.readUInt16LE(p + 34);
    const external = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (p > eocd) throw malformed("central directory entry runs past its end");

    const utf8 = (flags & 0x800) !== 0;
    if (!utf8 && nameBytes.some((b) => b > 0x7f)) {
      throw new ImportError("ARCHIVE_UNSUPPORTED", "The ZIP has file names in a legacy (non-UTF-8) encoding.", "Re-zip with a current tool, or rename files to ASCII.");
    }
    const rawName = nameBytes.toString(utf8 ? "utf8" : "latin1");
    if (flags & 0x1) throw new ImportError("ARCHIVE_UNSUPPORTED", `Encrypted ZIP entries are not supported (${rawName}).`, "Upload an unencrypted ZIP.");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || diskStart !== 0) {
      throw new ImportError("ARCHIVE_UNSUPPORTED", "ZIP64 archives are not supported.");
    }
    const mode = (madeBy >>> 8) === UNIX_HOST ? external >>> 16 : 0;
    const type = mode & S_IFMT;
    if (type === S_IFLNK) {
      throw new ImportError("ARCHIVE_SYMLINK", `The ZIP contains a symbolic link (${rawName.slice(0, 120)}); links are never extracted.`, "Replace the link with the real file and export again.");
    }
    const isDir = rawName.endsWith("/") || type === S_IFDIR;
    if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) {
      throw new ImportError("ARCHIVE_UNSUPPORTED", `The ZIP contains a special file (${rawName.slice(0, 120)}).`);
    }
    const name = safeRelativePath(rawName, limits);
    if (!isDir) {
      if (method !== 0 && method !== 8) {
        throw new ImportError("ARCHIVE_UNSUPPORTED", `Unsupported compression method ${method} for ${name}; only stored and deflated files are supported.`);
      }
      if (size > limits.maxFileBytes) {
        throw new ImportError("ARCHIVE_TOO_LARGE_EXTRACTED", `${name} is ${mb(size)} uncompressed; the per-file limit is ${mb(limits.maxFileBytes)}.`, "Remove or compress large assets.");
      }
      declaredTotal += size;
      if (declaredTotal > limits.maxTotalBytes) {
        throw new ImportError("ARCHIVE_TOO_LARGE_EXTRACTED", `The ZIP expands to more than ${mb(limits.maxTotalBytes)}.`, "Do not include node_modules, build output or large media.");
      }
    }
    entries.push({ name, isDir, method, crc, compressedSize, size, localOffset });
  }

  const seen = new Set<string>();
  const ranges: [number, number][] = [];
  const files: ZipFile[] = [];
  let actualTotal = 0;
  for (const e of entries) {
    // Case-insensitive: on a case-insensitive filesystem `A.ts` and `a.ts` would overwrite each other.
    const key = e.name.toLowerCase();
    if (seen.has(key)) {
      throw new ImportError("ARCHIVE_DUPLICATE_PATH", `The ZIP lists ${e.name} more than once (names are compared case-insensitively).`);
    }
    seen.add(key);
    if (e.isDir) continue;

    const lo = e.localOffset;
    if (lo + 30 > cdOffset || buf.readUInt32LE(lo) !== LOCAL) throw malformed(`bad local header for ${e.name}`);
    const localNameLen = buf.readUInt16LE(lo + 26);
    const localExtraLen = buf.readUInt16LE(lo + 28);
    const localName = buf.subarray(lo + 30, lo + 30 + localNameLen).toString((buf.readUInt16LE(lo + 6) & 0x800) !== 0 ? "utf8" : "latin1");
    if (localName.normalize("NFC") !== e.name && localName.normalize("NFC") !== `${e.name}/`) {
      throw malformed(`local and central names differ for ${e.name}`);
    }
    const start = lo + 30 + localNameLen + localExtraLen;
    const end = start + e.compressedSize;
    if (end > cdOffset) throw malformed(`data for ${e.name} runs into the central directory`);
    for (const [a, b] of ranges) {
      if (lo < b && end > a) throw malformed(`entries overlap at ${e.name}`);
    }
    ranges.push([lo, end]);

    const raw = buf.subarray(start, end);
    let data: Buffer;
    if (e.method === 0) {
      if (raw.length !== e.size) throw malformed(`size mismatch for ${e.name}`);
      data = Buffer.from(raw);
    } else {
      try {
        // Never inflate past the declared size: a lying header cannot expand into a bomb.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
      } catch (err) {
        if (err instanceof RangeError) throw malformed(`${e.name} expands beyond its declared size`);
        throw malformed(`cannot decompress ${e.name}`);
      }
      if (data.length !== e.size) throw malformed(`size mismatch for ${e.name}`);
    }
    if (crc32(data) >>> 0 !== e.crc >>> 0) throw malformed(`checksum mismatch for ${e.name}`);
    actualTotal += data.length;
    if (actualTotal > limits.maxTotalBytes) {
      throw new ImportError("ARCHIVE_TOO_LARGE_EXTRACTED", `The ZIP expands to more than ${mb(limits.maxTotalBytes)}.`);
    }
    files.push({ path: e.name, data });
  }
  // A file and a directory of the same name (or a file nested under a file) cannot both exist on disk.
  const names = new Set(files.map((f) => f.path.toLowerCase()));
  for (const f of files) {
    const parts = f.path.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) {
      if (names.has(parts.slice(0, i).join("/"))) {
        throw new ImportError("ARCHIVE_DUPLICATE_PATH", `${f.path} is nested under a file of the same name.`);
      }
    }
  }
  return files;
}

function mb(n: number): string {
  return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
}
