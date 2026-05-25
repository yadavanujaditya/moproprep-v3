// --- Payment Service ---
// Handles Razorpay payment integration for Pro membership

const PaymentService = {
    currentOrderId: null,
    onSuccessCallback: null,

    // Fetch dynamic price from Firestore settings
    async getPrice() {
        try {
            const doc = await db.collection('settings').doc('pricing').get();
            if (doc.exists && doc.data().amount) {
                return doc.data().amount;
            }
            return 299; // Default fallback price
        } catch (e) {
            console.error("Failed to fetch price:", e);
            return 299;
        }
    },

    // Initiate payment flow
    async initiatePayment(userEmail, onSuccess) {
        this.onSuccessCallback = onSuccess;

        try {
            // Get current price
            const amount = await this.getPrice();
            console.log("Initiating payment for amount:", amount);

            // Step 1: Create order on server
            const orderRes = await fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: amount })
            });

            if (!orderRes.ok) {
                throw new Error('Failed to create payment order');
            }

            const order = await orderRes.json();
            this.currentOrderId = order.id;
            console.log("Order created:", order.id);

            // Step 2: Open Razorpay checkout
            const options = {
                key: 'rzp_live_SsWJknuClDmrqN', // Your Razorpay Key ID (public key from .env)
                amount: order.amount,
                currency: order.currency || "INR",
                name: "MoProPrep",
                description: "Pro Membership - Unlimited Access",
                order_id: order.id,
                prefill: {
                    email: userEmail
                },
                theme: {
                    color: "#6C63FF"
                },
                handler: (response) => this.handlePaymentSuccess(response),
                modal: {
                    ondismiss: () => {
                        console.log("Payment modal closed by user");
                    }
                }
            };

            const rzp = new Razorpay(options);
            rzp.on('payment.failed', (response) => this.handlePaymentFailure(response));
            rzp.open();

        } catch (err) {
            console.error("Payment initiation error:", err);
            alert("Failed to initiate payment: " + err.message);
        }
    },

    // Handle successful payment
    async handlePaymentSuccess(response) {
        console.log("Payment success response:", response);

        try {
            // Verify payment on server
            const verifyRes = await fetch('/api/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                    uid: AuthService.user ? AuthService.user.uid : null
                })
            });

            const result = await verifyRes.json();

            if (result.success) {
                console.log("Payment verified successfully!");

                // Update local user state immediately
                if (AuthService.user) {
                    AuthService.user.isPro = true;
                }

                // Update PRO badge visibility
                const proBadge = document.getElementById('pro-badge');
                if (proBadge) {
                    proBadge.style.display = 'inline';
                }

                alert("🎉 Payment successful! Welcome to MoProPrep Pro!");

                // Execute success callback
                if (this.onSuccessCallback) {
                    this.onSuccessCallback();
                }
            } else {
                console.error("Payment verification failed");
                alert("Payment verification failed. Please contact support.");
            }
        } catch (err) {
            console.error("Payment verification error:", err);
            alert("Error verifying payment. Please contact support with your payment ID: " + response.razorpay_payment_id);
        }
    },

    // Handle payment failure
    handlePaymentFailure(response) {
        console.error("Payment failed:", response.error);
        alert("Payment failed: " + response.error.description + "\n\nPlease try again.");
    }
};
