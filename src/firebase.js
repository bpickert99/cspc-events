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
  storageBucket: "cspc-events-storage",
  messagingSenderId: "1007458426858",
  appId: "1:1007458426858:web:055efcef1f6bdbc17edc93"
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST MODE: When true, emails are logged to console instead of sent.
// Set to false once Microsoft Graph API is configured.
// ─────────────────────────────────────────────────────────────────────────────
export const TEST_MODE = false;

export const EMAILJS_CONFIG = {
  serviceId: "service_nntjsyg",
  templateId: "template_h0hio4p",
  publicKey: "VvkOnZERqW9UZQEgk",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
