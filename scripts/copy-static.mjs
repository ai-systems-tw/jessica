import { cp, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = new URL("apps/try-on-web/public/", root);
const destination = new URL("dist/apps/try-on-web/", root);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
