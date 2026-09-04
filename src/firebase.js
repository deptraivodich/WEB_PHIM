import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

/**
 * 210LoliPhim Firebase Cloud Configuration
 * Reads credentials from .env with real loliphim-db defaults
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAGHXUI532mAIY6oZt4YMeEFgJ9d_AzkIk",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "loliphim-db.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "loliphim-db",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "loliphim-db.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "777667759807",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:777667759807:web:850de2ad4fba34b8a2400a",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-Q1VNM6BZTB"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize & Export Cloud Firestore Database
export const db = getFirestore(app);

// Initialize & Export Firebase Authentication
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Analytics conditionally (only when supported in browser)
let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics is optional and suppressed in development or unsupported environments
  });
}

export {
  analytics,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
};

export default app;
