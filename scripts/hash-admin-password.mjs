import { createHash } from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("Usage: pnpm admin:hash -- <password>");
  process.exit(1);
}

console.log(createHash("md5").update(password).digest("hex"));
