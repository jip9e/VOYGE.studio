import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCJiKnR1Q1fWiwj-2a6CEd5iQjf3gRLtgI",
  authDomain: "voyge-studio.firebaseapp.com",
  projectId: "voyge-studio",
  storageBucket: "voyge-studio.firebasestorage.app",
  messagingSenderId: "496304919508",
  appId: "1:496304919508:web:f09fc661798bbe24e0bc41",
  measurementId: "G-GYHQ0LPKDL"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
