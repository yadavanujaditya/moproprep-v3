// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDC7z0pO_45J55jIt69FPLz0uHlCipz8ck",
    authDomain: "haryanamopro.firebaseapp.com",
    projectId: "haryanamopro",
    storageBucket: "haryanamopro.firebasestorage.app",
    messagingSenderId: "630125178852",
    appId: "1:630125178852:web:8a067decb752d7ef4721f1",
    measurementId: "G-QRCQJ5F118"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' }); // Force account chooser
