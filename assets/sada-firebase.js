// ---------------------------------------------------------------------------
// Sadapanna — thin Firestore data layer (view-only reads).
//
// Loads the Firebase modular SDK from the gstatic CDN (no build step), and
// exposes small helpers the pages use to render projects and blog posts with
// cursor-based "Load more" pagination.
// ---------------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let _db = null;
function db() {
  if (!_db) _db = getFirestore(initializeApp(firebaseConfig));
  return _db;
}

// Fetch one page of a collection.
//   name   — collection name ("projects" | "blogs")
//   field  — field to order by ("order" | "createdAt")
//   dir    — "asc" | "desc"
//   size   — page size
//   cursor — the last document snapshot from the previous page (or null)
// Returns { items, cursor, done }. `cursor` is a DocumentSnapshot to pass back
// in for the next page; `done` is true when there are no more pages.
export async function fetchPage(name, { field, dir = "asc", size = 6, cursor = null } = {}) {
  const parts = [collection(db(), name), orderBy(field, dir)];
  if (cursor) parts.push(startAfter(cursor));
  parts.push(limit(size));
  const snap = await getDocs(query(...parts));
  const docs = snap.docs;
  return {
    items: docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: docs.length ? docs[docs.length - 1] : cursor,
    done: docs.length < size,
  };
}

// Fetch a single blog post by its slug. Returns the doc data or null.
export async function fetchBySlug(name, slug) {
  const snap = await getDocs(
    query(collection(db(), name), where("slug", "==", slug), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// Escape a value for safe insertion as HTML text.
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Render a title with its accent word wrapped in <em> (the handwritten style),
// e.g. accentName("Arrow Flux", "Flux") → "Arrow <em>Flux</em>".
export function accentName(name, accent) {
  const safe = esc(name);
  if (accent && String(name).indexOf(accent) !== -1) {
    return safe.replace(esc(accent), "<em>" + esc(accent) + "</em>");
  }
  return safe;
}
