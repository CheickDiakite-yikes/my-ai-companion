import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { injectShareMeta, resolveRequestOrigin, resolveShareMetaForPath } from "./social-share";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", async (req, res, next) => {
    try {
      const template = await fs.promises.readFile(path.resolve(distPath, "index.html"), "utf-8");
      const requestPath = new URL(
        req.originalUrl,
        `${resolveRequestOrigin(req)}`,
      ).pathname;
      const meta = resolveShareMetaForPath(requestPath, resolveRequestOrigin(req));
      const page = injectShareMeta(template, meta);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (error) {
      next(error);
    }
  });
}
