import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// ─────────────────────────────────────────────────────────────────────────────
// SETUP: Replace these values with your Firebase project credentials.
// Get them from: Firebase Console → Project Settings → General → Your apps
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAqTzvSMlnoAzCREk-X4SKmht-I_vjeM80",
  authDomain: "cspc-events.firebaseapp.com",
  projectId: "cspc-events",
  storageBucket: "cspc-events.firebasestorage.app",
  messagingSenderId: "1007458426858",
  appId: "1:1007458426858:web:055efcef1f6bdbc17edc93"
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST MODE: When true, emails are logged to console instead of sent.
// Set to false once Microsoft Graph API is configured.
// ─────────────────────────────────────────────────────────────────────────────
export const TEST_MODE = true;

// Microsoft Graph API config (for real email sending — fill in after IT setup)
export const GRAPH_CONFIG = {
  clientId: "REPLACE_WITH_AZURE_CLIENT_ID",
  tenantId: "REPLACE_WITH_AZURE_TENANT_ID",
  senderEmail: "events@thepresidency.org",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
