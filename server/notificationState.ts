import crypto from "node:crypto";
import { getFirestoreDocument, isFirestoreConfigured, setFirestoreDocument } from "./firestore.js";
import { getFluxoraCollectionPaths } from "./fluxoraFirestorePaths.js";

const COLLECTION = getFluxoraCollectionPaths("notificationState").destination;
const MAX_SEEN_EXECUTIONS = 250;

function documentId(email: string) {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("base64url");
}

export async function getNotificationReadState(email: string) {
  if (!isFirestoreConfigured()) {
    return { configured: false, initialized: false, seenErrorExecutionIds: [] as string[] };
  }

  const document = await getFirestoreDocument(COLLECTION, documentId(email));
  const stored = Array.isArray(document?.seenErrorExecutionIds) ? document.seenErrorExecutionIds : [];
  return {
    configured: true,
    initialized: Boolean(document),
    seenErrorExecutionIds: stored.map(String).slice(0, MAX_SEEN_EXECUTIONS),
  };
}

export async function saveNotificationReadState(email: string, executionIds: string[]) {
  const ids = [...new Set(executionIds.map(String))].slice(0, MAX_SEEN_EXECUTIONS);
  if (!isFirestoreConfigured()) {
    return { configured: false, initialized: true, seenErrorExecutionIds: ids };
  }

  await setFirestoreDocument(COLLECTION, documentId(email), {
    email: email.trim().toLowerCase(),
    seenErrorExecutionIds: ids,
    updatedAt: new Date().toISOString(),
  });
  return { configured: true, initialized: true, seenErrorExecutionIds: ids };
}
