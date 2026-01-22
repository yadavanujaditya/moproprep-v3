// --- Payment Service ---

const PaymentService = {
    // Start the payment process
    async initiatePayment(email, onComplete) {
        try {
            // 0. Fetch price from Firestore (Admin-controlled)
            let price = 299; // Default fallback
            try {
                const pricingDoc = await db.collection('settings').doc('pricing').get();
                if (pricingDoc.exists && pricingDoc.data().amount) {
                    price = pricingDoc.data().amount;
                }
            } catch (e) {
                console.warn("Could not fetch dynamic price, using default:", e);
            }

            // Show confirmation dialog
            const confirmed = confirm(`HaryanaMo Pro Membership costs ₹${price}.\n\nProceed to payment?`);
            if (!confirmed) {
                console.log("User cancelled payment.");
                return;
            }

            // 1. Create order on your backend
            const response = await fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: price, email: email })
            });

            const order = await response.json();
            if (!order.id) throw new Error("Order creation failed");

            if (typeof Razorpay === 'undefined') {
                alert("Payment gateway failed to load. Please check your internet or disable ad-blockers.");
                throw new Error("Razorpay SDK not loaded");
            }

            // 2. Open Razorpay Checkout
            const options = {
                key: "rzp_live_S5svGNMN2lRtYf", // Live Key
                amount: order.amount,
                currency: order.currency,
                name: "HaryanaMo Pro",
                description: "One-time PRO Membership",
                order_id: order.id,
                prefill: { email: email },
                handler: async function (response) {
                    // 3. Verify payment on backend
                    try {
                        const verifyRes = await fetch('/api/verify-payment', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                                uid: auth.currentUser.uid
                            })
                        });

                        const result = await verifyRes.json();

                        if (result.success) {
                            // Update Firestore - Retry logic
                            let retries = 3;
                            let success = false;

                            while (retries > 0 && !success) {
                                try {
                                    await db.collection('users').doc(auth.currentUser.uid).set({
                                        isPro: true,
                                        paymentId: response.razorpay_payment_id,
                                        paidAt: firebase.firestore.FieldValue.serverTimestamp()
                                    }, { merge: true });
                                    success = true;
                                } catch (e) {
                                    console.error("Firestore write failed, retrying...", e);
                                    retries--;
                                    await new Promise(r => setTimeout(r, 1000));
                                }
                            }

                            if (!success) {
                                // Fallback: Alert user to contact admin if DB write fails
                                alert("Payment received, but account update failed. Please contact admin with Payment ID: " + response.razorpay_payment_id);
                                return;
                            }

                            // Manual Force Local Update
                            if (AuthService.user) AuthService.user.isPro = true;

                            // SET LOCAL STORAGE FLAG (Robustness)
                            if (auth.currentUser) {
                                localStorage.setItem('isLocalPro_' + auth.currentUser.uid, 'true');
                            }

                            alert("Payment successful! You are now a PRO member. 🎉");
                            if (onComplete) onComplete();
                        } else {
                            alert("Payment verification failed: " + (result.error || "Unknown Error"));
                        }
                    } catch (err) {
                        console.error("Verification error:", err);
                        alert("Network error during verification. Please contact support.");
                    }
                },
                theme: { color: "#2563eb" },
                modal: {
                    ondismiss: function () {
                        console.log('Checkout form closed');
                    }
                }
            };

            const rzp = new Razorpay(options);
            // Handle failure
            rzp.on('payment.failed', function (response) {
                console.error(response.error);
                const errorMsg = response.error.description || "Unknown error";
                const paymentId = response.error.metadata?.payment_id || "N/A";

                // Show detailed message for refund if money was deducted
                alert(
                    "⚠️ Payment Failed!\n\n" +
                    "Reason: " + errorMsg + "\n\n" +
                    "If your money has been deducted, please don't worry!\n\n" +
                    "📱 Contact us on Telegram: t.me/yadavanujaditya\n\n" +
                    "Please share the following details:\n" +
                    "• Your registered email\n" +
                    "• Payment ID: " + paymentId + "\n" +
                    "• Screenshot of transaction (if available)\n\n" +
                    "Your refund will be processed within 5-7 business days. 🙏"
                );
            });

            rzp.open();

        } catch (error) {
            console.error("Payment failed:", error.message);
            alert("Error initiating payment: " + error.message);
        }
    }
};
