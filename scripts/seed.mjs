// ---------------------------------------------------------------------------
// Seed / update Firestore with the site's projects and blog posts.
//
// The website's security rules are view-only (clients can't write), so content
// is written here with the Admin SDK, which runs with full privileges and
// bypasses rules. Run it whenever you add or edit a project or post.
//
// Auth: Application Default Credentials (ADC) — no key file to manage.
//
// Setup (once):
//   1. gcloud auth application-default login
//        (log in as an account with write access to the Firestore project)
//   2. cd scripts && npm install
//
// Run:
//   node seed.mjs            # seed everything (projects + blogs)
//   node seed.mjs projects   # only projects
//   node seed.mjs blogs      # only blogs
//
// Docs are keyed by their "id", so re-running updates in place (idempotent).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

// Project id is the single source of truth in ../.firebaserc.
const projectId = JSON.parse(read("../.firebaserc")).projects.default;

// Use Application Default Credentials. Locally these come from
// `gcloud auth application-default login`; in CI/GCP they come from the
// environment (GOOGLE_APPLICATION_CREDENTIALS or the metadata server).
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId,
});
const db = admin.firestore();

const data = JSON.parse(read("seed-data.json"));

async function seedCollection(name, items) {
  console.log(`\nSeeding "${name}" (${items.length})…`);
  for (const item of items) {
    const { id, bodyFile, createdAt, ...rest } = item;
    const doc = { ...rest };

    // Inline the article body from its HTML file, if referenced.
    if (bodyFile) doc.body = read(bodyFile);

    // Store an ordered timestamp: explicit date if given, else "now".
    doc.createdAt = createdAt
      ? admin.firestore.Timestamp.fromDate(new Date(createdAt))
      : admin.firestore.FieldValue.serverTimestamp();
    doc.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const ref = id ? db.collection(name).doc(id) : db.collection(name).doc();
    await ref.set(doc, { merge: true });
    console.log(`  ✓ ${name}/${ref.id}`);
  }
}

const only = process.argv[2];
try {
  if (!only || only === "projects") await seedCollection("projects", data.projects || []);
  if (!only || only === "blogs") await seedCollection("blogs", data.blogs || []);
} catch (err) {
  const msg = String(err && err.message);
  if (/Could not load the default credentials|credential|UNAUTHENTICATED|PERMISSION_DENIED/i.test(msg)) {
    console.error(
      "\n✗ Couldn't authenticate to Firestore.\n" +
        "  Run:  gcloud auth application-default login\n" +
        "  and make sure that account can write to project '" + projectId + "'.\n"
    );
    process.exit(1);
  }
  throw err;
}

console.log("\nDone.");
process.exit(0);
