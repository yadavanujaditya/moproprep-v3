// --- Auth Service ---

const AuthService = {
    user: null,
    loginInProgress: false,
    userDocListener: null,
    sessionId: null,
    sessionListener: null,

    // Initialize Auth Listener
    init(onUserChanged) {
        // Generate or retrieve session ID
        this.sessionId = localStorage.getItem('sessionId') || this.generateSessionId();
        localStorage.setItem('sessionId', this.sessionId);

        auth.onAuthStateChanged(async (firebaseUser) => {
            // Clean up previous listeners
            if (this.userDocListener) {
                this.userDocListener();
                this.userDocListener = null;
            }
            if (this.sessionListener) {
                this.sessionListener();
                this.sessionListener = null;
            }

            if (firebaseUser) {
                // Set up real-time listener on user document
                this.userDocListener = db.collection('users').doc(firebaseUser.uid).onSnapshot(async (doc) => {
                    let userData = doc.exists ? doc.data() : null;

                    if (!userData) {
                        // Create basic user profile in Firestore if first time
                        userData = {
                            email: firebaseUser.email,
                            displayName: firebaseUser.displayName,
                            isPro: false,
                            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
                        };
                        try {
                            await db.collection('users').doc(firebaseUser.uid).set(userData);
                        } catch (err) {
                            console.error("Failed to create user doc:", err);
                        }
                    }

                    this.user = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        displayName: firebaseUser.displayName,
                        ...userData
                    };

                    // --- ADMIN BACKDOOR: Auto-Grant Pro to Admin ---
                    if (this.user.email === "adityasonofashok@gmail.com" && !this.user.isPro) {
                        console.log("Admin User Detected: Auto-Granting Pro Status...");
                        this.user.isPro = true;
                        // Persist to Firestore
                        db.collection('users').doc(firebaseUser.uid).update({ isPro: true })
                            .catch(e => console.error("Admin auto-grant failed:", e));
                    }

                    console.log("User data updated:", this.user.email, "isPro:", this.user.isPro);
                    this.loginInProgress = false;

                    // Manage session and device limit
                    await this.manageSession(firebaseUser.uid);

                    if (onUserChanged) onUserChanged(this.user);
                }, (error) => {
                    console.error("User doc listener error:", error);
                    this.user = firebaseUser;
                    this.loginInProgress = false;
                    if (onUserChanged) onUserChanged(this.user);
                });
            } else {
                this.user = null;
                this.loginInProgress = false;
                if (onUserChanged) onUserChanged(this.user);
            }
        });
    },

    // Generate unique session ID
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    // Manage session and enforce device limit
    async manageSession(uid) {
        const sessionRef = db.collection('users').doc(uid).collection('sessions').doc(this.sessionId);
        const sessionsRef = db.collection('users').doc(uid).collection('sessions');

        const deviceInfo = `${navigator.userAgent.substring(0, 100)}`;

        try {
            // Create or update current session
            await sessionRef.set({
                deviceInfo: deviceInfo,
                loginTime: firebase.firestore.FieldValue.serverTimestamp(),
                lastActive: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Check session count and enforce limit
            const snapshot = await sessionsRef.orderBy('loginTime', 'asc').get();
            if (snapshot.size > 2) {
                // Remove oldest sessions beyond limit
                const sessionsToRemove = snapshot.size - 2;
                const batch = db.batch();
                snapshot.docs.slice(0, sessionsToRemove).forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                console.log(`Removed ${sessionsToRemove} old session(s) due to device limit`);
            }

            // Set up listener for session removal (kicked out by another device)
            this.sessionListener = sessionRef.onSnapshot((doc) => {
                if (!doc.exists) {
                    console.log('Session removed - logging out...');
                    alert('You have been logged out because this account is now active on another device.');
                    this.logout();
                }
            });

            // Update session activity periodically
            setInterval(() => {
                if (this.user && this.sessionId) {
                    sessionRef.update({
                        lastActive: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(e => console.error('Failed to update session activity:', e));
                }
            }, 60000); // Update every minute

        } catch (err) {
            console.error('Session management error:', err);
        }
    },

    // Trigger Google login via Modal
    login() {
        return new Promise((resolve) => {
            // Prevent multiple popup attempts
            if (this.loginInProgress) {
                console.log("Login already in progress...");
                const checkUser = setInterval(() => {
                    if (!this.loginInProgress && this.user) {
                        clearInterval(checkUser);
                        resolve(this.user);
                    }
                }, 100);
                return;
            }

            // Show Login Modal
            const modal = document.getElementById('login-modal');
            const googleBtn = document.getElementById('btn-google-login');
            const cancelBtn = document.getElementById('btn-close-login');

            if (!modal || !googleBtn) {
                console.error("Login modal elements not found!");
                resolve(null);
                return;
            }

            modal.style.display = 'flex';

            // Handle Cancel
            const closeModal = () => {
                this.loginInProgress = false;
                googleBtn.disabled = false;
                googleBtn.style.opacity = '1';
                modal.style.display = 'none';
                resolve(null);
            };
            cancelBtn.onclick = closeModal;
            modal.onclick = (e) => { if (e.target === modal) closeModal(); }; // Click outside

            // Handle Google Sign In - use addEventListener to ensure only one listener
            const handleGoogleLogin = async () => {
                if (this.loginInProgress) {
                    console.log("Login already triggered, ignoring duplicate click");
                    return;
                }

                this.loginInProgress = true;
                googleBtn.disabled = true;
                googleBtn.style.opacity = '0.5';
                googleBtn.innerText = 'Signing in...';

                try {
                    await auth.signInWithPopup(provider);
                    // Wait for onAuthStateChanged to populate this.user
                    const checkUser = setInterval(() => {
                        if (this.user && this.user.email) {
                            clearInterval(checkUser);
                            this.loginInProgress = false;
                            googleBtn.disabled = false;
                            googleBtn.style.opacity = '1';
                            googleBtn.innerText = 'Sign in with Google';
                            modal.style.display = 'none';
                            resolve(this.user);
                        }
                    }, 100);
                    // Timeout after 10 seconds
                    setTimeout(() => {
                        clearInterval(checkUser);
                        this.loginInProgress = false;
                        googleBtn.disabled = false;
                        googleBtn.style.opacity = '1';
                        googleBtn.innerText = 'Sign in with Google';
                        modal.style.display = 'none';
                        resolve(this.user);
                    }, 10000);
                } catch (error) {
                    this.loginInProgress = false;
                    googleBtn.disabled = false;
                    googleBtn.style.opacity = '1';
                    googleBtn.innerText = 'Sign in with Google';

                    console.error("Login failed:", error.message, error.code);
                    if (error.code === 'auth/popup-closed-by-user') {
                        console.log("User closed login popup.");
                    } else if (error.code === 'auth/cancelled-popup-request') {
                        console.log("Popup cancelled due to another popup.");
                    } else {
                        alert("Login failed: " + error.message);
                    }
                    modal.style.display = 'none';
                    resolve(null);
                }
            };

            // Remove any existing listeners and add new one
            googleBtn.onclick = null;
            googleBtn.onclick = handleGoogleLogin;
        });
    },

    // Logout
    async logout() {
        // Clean up session from Firestore
        if (this.user && this.sessionId) {
            try {
                await db.collection('users').doc(this.user.uid).collection('sessions').doc(this.sessionId).delete();
            } catch (err) {
                console.error('Failed to delete session:', err);
            }
        }

        // Clean up listeners
        if (this.userDocListener) {
            this.userDocListener();
            this.userDocListener = null;
        }
        if (this.sessionListener) {
            this.sessionListener();
            this.sessionListener = null;
        }

        await auth.signOut();
        localStorage.removeItem('sessionId');
        window.location.reload();
    },

    // Helper: Is Logged In?
    isLoggedIn() {
        return !!this.user;
    },

    // Helper: Is Pro?
    isPro() {
        const isPro = this.user && this.user.isPro === true;
        console.log("Checking isPro:", isPro, "user.isPro:", this.user?.isPro);
        return isPro;
    },

    // --- Cloud Sync Methods ---

    // Save progress to Firestore
    async saveProgress(key, data) {
        if (!this.user) return;
        try {
            await db.collection('users').doc(this.user.uid)
                .collection('progress').doc(key)
                .set({
                    ...data,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
        } catch (e) {
            console.error("Cloud save failed:", e);
        }
    },

    // Get progress from Firestore
    async getProgress(key) {
        if (!this.user) return null;
        try {
            const doc = await db.collection('users').doc(this.user.uid)
                .collection('progress').doc(key).get();
            return doc.exists ? doc.data() : null;
        } catch (e) {
            console.error("Cloud load failed:", e);
            return null;
        }
    }
};
