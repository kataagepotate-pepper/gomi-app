// PCの中で試すためのAPIサーバー部品。
// 本物のPostgreSQLの代わりに PGlite（PCの中で動くPostgreSQL）を使う。
// 起動のたびに db/schema.sql を流す（何度流しても壊れない作りになっている）。
// 隠しページ /admin の合言葉は、環境変数 ADMIN_PASSWORD があればそれを使う。
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHandler } from "./handler.js";

export async function createLocalApi({ dataDir = "./.localdb", adminKey = process.env.ADMIN_PASSWORD || "", now } = {}) {
  const pg = new PGlite(dataDir);
  await pg.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));

  // PGlite は1本の接続しか持てないので、問い合わせを順番待ちにする
  let chain = Promise.resolve();
  const enqueue = (work) => {
    const run = chain.then(work);
    chain = run.catch(() => {});
    return run;
  };
  const query = (text, params = []) => enqueue(() => pg.query(text, params)).then((r) => r.rows);
  const transaction = (fn) =>
    enqueue(() => pg.transaction((tx) => fn({ query: (text, params = []) => tx.query(text, params).then((r) => r.rows) })));
  const handle = createHandler({ query, transaction }, { adminKey, now });

  const fetchApi = (request) => handle(request);

  // Node の http サーバーにつなぐための変換
  async function middleware(req, res, next) {
    if (!req.url.startsWith("/api/")) return next();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] || "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await fetchApi(request);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  return { middleware, fetchApi, pg, close: () => pg.close() };
}
