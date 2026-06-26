#!/usr/bin/env node
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const defaultNeonInterns = 3;
const defaultPhiLocalInterns = 3;
const bcryptRounds = 12;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);

  if (index < 0) {
    return fallback;
  }

  return process.argv[index + 1] ?? fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function parseCount(name, fallback) {
  const value = Number.parseInt(getArg(name, String(fallback)), 10);

  if (!Number.isFinite(value) || value < 0 || value > 99) {
    throw new Error(`${name} must be an integer from 0 to 99.`);
  }

  return value;
}

function validateDeploymentShape({ neonCount, phiCount }) {
  const totalInterns = neonCount + phiCount;

  if (totalInterns < 6) {
    throw new Error("generate-users requires at least six active intern accounts.");
  }

  if (neonCount < 1 || phiCount < 1) {
    throw new Error("generate-users requires at least one Neon-enabled intern and one PHI-local intern.");
  }
}

function makePassword() {
  return randomBytes(18).toString("base64url");
}

function quoteShellValue(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function findSmokeCredential(credentials, workflowMode) {
  return credentials.find((credential) => credential.workflowMode === workflowMode || credential.workflowMode === "dual");
}

function printSmokeEnv(credentials) {
  const neon = findSmokeCredential(credentials, "neon");
  const phiLocal = findSmokeCredential(credentials, "phi_local");
  const admin = credentials.find((credential) => credential.username === "admin");

  if (!neon || !phiLocal || !admin) {
    throw new Error("Smoke env output requires one Neon account, one PHI-local account, and admin.");
  }

  console.log("");
  console.log("# Optional runtime smoke exports for these generated accounts:");
  console.log("# Use after setting INTERN_USERS_JSON and running npm run seed-users against the target app database.");
  console.log(`SMOKE_NEON_USERNAME=${quoteShellValue(neon.username)} \\`);
  console.log(`SMOKE_NEON_PASSWORD=${quoteShellValue(neon.temporaryPassword)} \\`);
  console.log(`SMOKE_NEON_WORKFLOW_MODE=${quoteShellValue(neon.workflowMode)} \\`);
  console.log(`SMOKE_PHI_USERNAME=${quoteShellValue(phiLocal.username)} \\`);
  console.log(`SMOKE_PHI_PASSWORD=${quoteShellValue(phiLocal.temporaryPassword)} \\`);
  console.log(`SMOKE_PHI_WORKFLOW_MODE=${quoteShellValue(phiLocal.workflowMode)} \\`);
  console.log(`SMOKE_ADMIN_USERNAME=${quoteShellValue(admin.username)} \\`);
  console.log(`SMOKE_ADMIN_PASSWORD=${quoteShellValue(admin.temporaryPassword)} \\`);
  console.log(`SMOKE_ADMIN_WORKFLOW_MODE=${quoteShellValue(admin.workflowMode)} \\`);
  console.log("npm run smoke:runtime");
}

async function buildUser({ username, displayName, role, workflowMode }) {
  const temporaryPassword = makePassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, bcryptRounds);

  return {
    user: {
      username,
      displayName,
      role,
      workflowMode,
      passwordHash,
    },
    credential: {
      username,
      temporaryPassword,
      workflowMode,
    },
  };
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(
      [
        "Usage: npm run generate-users -- [--neon-count 3] [--phi-count 3] [--json-only] [--smoke-env]",
        "",
        "Prints a ready-to-seed INTERN_USERS_JSON value and one-time temporary passwords.",
        "--smoke-env also prints shell exports for npm run smoke:runtime using the generated accounts.",
        "Custom counts must include at least six interns, at least one Neon intern, and at least one PHI-local intern.",
        "Do not commit the generated output. Set INTERN_USERS_JSON in Vercel/server env, then run npm run seed-users.",
      ].join("\n"),
    );
    return;
  }

  const neonCount = parseCount("--neon-count", defaultNeonInterns);
  const phiCount = parseCount("--phi-count", defaultPhiLocalInterns);
  validateDeploymentShape({ neonCount, phiCount });

  const jsonOnly = hasArg("--json-only");
  const smokeEnv = hasArg("--smoke-env");
  const generated = [];
  const credentials = [];
  let internNumber = 1;

  for (let index = 0; index < neonCount; index += 1) {
    const username = `intern${String(internNumber).padStart(2, "0")}`;
    const generatedUser = await buildUser({
      username,
      displayName: `Intern ${String(internNumber).padStart(2, "0")}`,
      role: "intern",
      workflowMode: "neon",
    });

    generated.push(generatedUser.user);
    credentials.push(generatedUser.credential);
    internNumber += 1;
  }

  for (let index = 0; index < phiCount; index += 1) {
    const username = `intern${String(internNumber).padStart(2, "0")}`;
    const generatedUser = await buildUser({
      username,
      displayName: `Intern ${String(internNumber).padStart(2, "0")}`,
      role: "intern",
      workflowMode: "phi_local",
    });

    generated.push(generatedUser.user);
    credentials.push(generatedUser.credential);
    internNumber += 1;
  }

  const admin = await buildUser({
    username: "admin",
    displayName: "Admin",
    role: "admin",
    workflowMode: "dual",
  });

  generated.push(admin.user);
  credentials.push(admin.credential);

  const usersJson = JSON.stringify(generated);

  if (jsonOnly) {
    console.log(usersJson);
    return;
  }

  console.log("# Set this in Vercel/server env, not in committed files:");
  console.log(`INTERN_USERS_JSON=${quoteShellValue(usersJson)}`);
  console.log("");
  console.log("# One-time temporary credentials. Store in an approved password handoff path, then rotate as needed:");

  for (const credential of credentials) {
    console.log(`${credential.username}\t${credential.workflowMode}\t${credential.temporaryPassword}`);
  }

  if (smokeEnv) {
    printSmokeEnv(credentials);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
