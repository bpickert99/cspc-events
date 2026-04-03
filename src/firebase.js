import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// ─────────────────────────────────────────────────────────────────────────────
// SETUP: Replace these values with your Firebase project credentials.
// Get them from: Firebase Console → Project Settings → General → Your apps
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID",
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
