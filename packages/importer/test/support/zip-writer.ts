import { crc32, deflateRawSync } from "node:zlib";

export interface WriteEntry {
  name: string;
  data?: Buffer | string;
  /** 0 = stored, 8 = deflated (default). */
  method?: 0 | 8;
  /** Unix mode bits, e.g. 0o120777 for a symlink; sets "made by Unix". */
  unixMode?: number;
  /** Override the declared uncompressed size (to forge a lying header). */
  declaredSize?: number;
  /** Override the declared CRC. */
  declaredCrc?: number;
  encrypted?: boolean;
}

/** Minimal ZIP writer for tests and fixtures: stored or deflated entries, optional forged headers. */
export function writeZip(entries: WriteEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : (e.data ?? Buffer.alloc(0));
    const method = e.name.endsWith("/") ? 0 : (e.method ?? 8);
    const body = method === 8 ? deflateRawSync(data) : data;
    const crc = e.declaredCrc ?? crc32(data) >>> 0;
    const size = e.declaredSize ?? data.length;
    const flags = 0x800 | (e.encrypted ? 1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.unixMode !== undefined ? (3 << 8) | 20 : 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.unixMode !== undefined ? (e.unixMode << 16) >>> 0 : 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A minimal valid Make-style export, optionally inside a wrapper directory. */
export function makeExport(opts: { wrapper?: string; extra?: WriteEntry[]; outside?: WriteEntry[]; omit?: string[]; pkg?: object } = {}): Buffer {
  const pkg = opts.pkg ?? {
    name: "@figma/my-make-file",
    private: true,
    type: "module",
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
    devDependencies: { vite: "6.3.5", "@vitejs/plugin-react-swc": "^3.10.2" },
    scripts: { dev: "vite", build: "vite build" },
  };
  const files: WriteEntry[] = [
    { name: "package.json", data: JSON.stringify(pkg, null, 2) },
    { name: "index.html", data: '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
    { name: "vite.config.ts", data: "import { defineConfig } from 'vite';\nexport default defineConfig({});\n" },
    { name: "src/main.tsx", data: "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n" },
    { name: "src/App.tsx", data: "export default function App() {\n  return <main><h1>Hello</h1><button>Continue</button></main>;\n}\n" },
    ...(opts.extra ?? []),
  ].filter((f) => !opts.omit?.includes(f.name));
  return writeZip([...(opts.wrapper ? files.map((f) => ({ ...f, name: `${opts.wrapper}/${f.name}` })) : files), ...(opts.outside ?? [])]);
}
