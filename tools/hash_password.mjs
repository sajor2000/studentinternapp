#!/usr/bin/env node
import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node tools/hash_password.mjs '<temporary-password>'");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);

console.log(hash);
