
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['https://blessing-suru.web.app', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

// Paystack Configuration - Use environment variable
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Validate environment variables
if (!PAYSTACK_SECRET_KEY) {
    console.error('❌ PAYSTACK_SECRET_KEY is required in environment variables');
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: '✅ Backend is running', 
        service: 'Favs Bling Payment Backend',
        timestamp: new Date().toISOString(),
        paystackMode: PAYSTACK_SECRET_KEY ? (PAYSTACK_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST') : 'NOT_CONFIGURED'
    });
});

// Test Paystack connection
app.get('/test-paystack', async (req, res) => {
    try {
        const response = await axios.get(`${PAYSTACK_BASE_URL}/transaction`, {
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
            },
            params: {
                perPage: 1
            }
        });
        
        res.json({ 
            success: true, 
            message: '✅ Paystack connection successful',
            mode: PAYSTACK_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST'
        });
    } catch (error) {
        console.error('Paystack test error:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            message: '❌ Paystack connection failed',
            error: error.response?.data?.message || error.message 
        });
    }
});

// ==================== PAYMENT ENDPOINTS ====================

/**
 * Initialize payment with Paystack
 */
app.post('/create-payment', async (req, res) => {
    try {
        const { orderId, amount, email, customerName, customerPhone, items, metadata } = req.body;

        // Validate required fields
        if (!orderId || !amount || !email) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: orderId, amount, email'
            });
        }

        // Validate amount (minimum 100 kobo = ₦1)
        if (amount < 100) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be at least ₦1 (100 kobo)'
            });
        }

        console.log(`🔄 Initializing payment for order: ${orderId}, Amount: ₦${amount/100}`);

        // Prepare Paystack payload
        const paystackPayload = {
            email: email,
            amount: Math.round(amount * 100), // Convert to kobo
            currency: 'NGN',
            reference: orderId,
            callback_url: `https://blessing-suru.web.app/?payment_verify=true`,
            metadata: {
                custom_fields: [
                    {
                        display_name: "Order ID",
                        variable_name: "order_id",
                        value: orderId
                    },
                    {
                        display_name: "Customer Name", 
                        variable_name: "customer_name",
                        value: customerName || 'Customer'
                    },
                    {
                        display_name: "Customer Phone",
                        variable_name: "customer_phone", 
                        value: customerPhone || 'Not provided'
                    },
                    {
                        display_name: "Items Count",
                        variable_name: "items_count",
                        value: items?.length || 0
                    }
                ]
            }
        };

        // Initialize payment with Paystack
        const response = await axios.post(
            `${PAYSTACK_BASE_URL}/transaction/initialize`,
            paystackPayload,
            {
                headers: {
                    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const paystackData = response.data;

        if (!paystackData.status) {
            throw new Error(paystackData.message || 'Failed to initialize payment');
        }

        console.log(`✅ Payment initialized for ${email}: ${paystackData.data.reference}`);

        // Return payment data to frontend
        res.json({
            success: true,
            message: 'Payment initialized successfully',
            data: {
                authorization_url: paystackData.data.authorization_url,
                access_code: paystackData.data.access_code,
                reference: paystackData.data.reference
            }
        });

    } catch (error) {
        console.error('❌ Payment initialization error:', error.response?.data || error.message);
        
        res.status(500).json({
            success: false,
            message: 'Payment initialization failed',
            error: error.response?.data?.message || error.message
        });
    }
});

/**
 * Verify payment with Paystack
 */
app.post('/verify-payment', async (req, res) => {
    try {
        const { reference } = req.body;

        if (!reference) {
            return res.status(400).json({
                success: false,
                message: 'Payment reference is required'
            });
        }

        console.log(`🔍 Verifying payment with reference: ${reference}`);

        // Verify payment with Paystack
        const response = await axios.get(
            `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
            {
                headers: {
                    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );

        const verificationData = response.data;

        if (!verificationData.status) {
            return res.status(400).json({
                success: false,
                message: verificationData.message || 'Payment verification failed'
            });
        }

        const transaction = verificationData.data;

        // Check if payment was successful
        if (transaction.status !== 'success') {
            return res.status(400).json({
                success: false,
                message: `Payment not successful. Status: ${transaction.status}`,
                status: transaction.status
            });
        }

        console.log(`✅ Payment verified successfully: ${reference}`);

        // Return verified payment data
        res.json({
            success: true,
            message: 'Payment verified successfully',
            paymentData: {
                reference: transaction.reference,
                amount: transaction.amount,
                currency: transaction.currency,
                status: transaction.status,
                paidAt: transaction.paid_at,
                channel: transaction.channel,
                email: transaction.customer.email,
                metadata: transaction.metadata
            }
        });

    } catch (error) {
        console.error('❌ Payment verification error:', error.response?.data || error.message);

        res.status(500).json({
            success: false,
            message: 'Payment verification failed',
            error: error.response?.data?.message || error.message
        });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Favs Bling Backend running on port ${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/health`);
    console.log(`💰 Paystack Mode: ${PAYSTACK_SECRET_KEY ? (PAYSTACK_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST') : 'NOT SET'}`);
});
