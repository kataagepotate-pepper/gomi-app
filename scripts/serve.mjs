// 作った画面（dist）とAPIをまとめて動かすテスト用サーバー。
// 同じWi-Fiのスマホから http://<このPCのIPアドレス>:8787 で開ける。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { createLocalApi } from "../server/local.js";

const PORT = Number(process.env.PORT || 8788); // ビンゴ（8787）と同時に動かせるようにずらしている
const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".json": "application/json" };

const api = await createLocalApi();

const server = createServer((req, res) => {
  api.middleware(req, res, async () => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([\\/])+/, "");
    let file = join(DIST, path);
    if (!file.startsWith(join(DIST))) file = join(DIST, "index.html");
    try {
      const body = await readFile(file);
      res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
      res.end(body);
    } catch {
      res.setHeader("Content-Type", TYPES[".html"]);
      res.end(await readFile(join(DIST, "index.html"))); // 画面の切り替えは React がやる
    }
  }).catch((err) => {
    console.error(err);
    res.statusCode = 500;
    res.end();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  このPCで開く:   http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) console.log(`  スマホから開く: http://${a.address}:${PORT}`);
    }
  }
  console.log("\n  止めるときは Ctrl + C\n");
});
