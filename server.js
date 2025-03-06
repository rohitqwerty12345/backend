require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const app = express();

// Validate required environment variables
const requiredEnvVars = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

// Add this middleware to set CORS headers for all routes
app.use((req, res, next) => {
  // Set CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Parse JSON requests
app.use(express.json());

// Initialize Razorpay with error handling
let razorpay;
try {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
  console.log('Razorpay initialized successfully');
} catch (error) {
  console.error('Failed to initialize Razorpay:', error);
  process.exit(1);
}

// Initialize Firebase Admin with better error handling
try {
  if (admin.apps.length === 0) { // Only initialize if not already initialized
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
    console.log('Firebase Admin initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error);
  process.exit(1);
}

// Root endpoint with API information
app.get('/', (req, res) => {
  res.json({
    name: 'PostSync Payment API',
    status: 'online',
    endpoints: {
      health: '/health',
      razorpayOrder: '/api/razorpay-order',
      razorpayVerify: '/api/razorpay-verify'
    },
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    razorpayInitialized: !!razorpay
  });
});

// Create Razorpay order endpoint
app.post('/api/razorpay-order', async (req, res) => {
  try {
    const { amount, orderId, currency = 'INR', notes = {} } = req.body;
    
    if (!amount) {
      return res.status(400).json({ success: false, error: 'Amount is required' });
    }
    
    const options = {
      amount: amount * 100, // Razorpay expects amount in paisa
      currency,
      receipt: orderId,
      notes
    };
    
    console.log('Creating Razorpay order with options:', JSON.stringify(options));
    const order = await razorpay.orders.create(options);
    console.log('Razorpay order created:', JSON.stringify(order));
    
    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create order',
      details: error.message || 'Unknown error'
    });
  }
});

// Verify Razorpay payment endpoint
app.post('/api/razorpay-verify', (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature 
    } = req.body;
    
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    
    // Verify the payment signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    
    const isSignatureValid = generatedSignature === razorpay_signature;
    
    if (!isSignatureValid) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }
    
    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to verify payment',
      details: error.message || 'Unknown error'
    });
  }
});

// Test endpoint for CORS
app.get('/test-cors', (req, res) => {
  console.log('CORS test request received');
  console.log('Origin:', req.headers.origin);
  
  res.json({
    message: 'CORS test successful',
    headers: {
      allowOrigin: res.getHeader('Access-Control-Allow-Origin'),
      allowMethods: res.getHeader('Access-Control-Allow-Methods'),
      allowHeaders: res.getHeader('Access-Control-Allow-Headers')
    },
    requestHeaders: req.headers
  });
});

// Replace the update-user-credits endpoint with this simplified version
app.post('/api/update-user-credits', async (req, res) => {
  try {
    const { 
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature 
    } = req.body;
    
    // 1. Verify payment signature first
    if (razorpay_signature === 'upi_payment') {
      // Skip signature verification for UPI payments
      isSignatureValid = true;
    } else {
      const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      
      const isSignatureValid = generatedSignature === razorpay_signature;
      
      if (!isSignatureValid) {
        return res.status(400).json({ success: false, error: 'Invalid signature' });
      }
    }
    
    // Return success - credits will be updated in frontend
    res.json({ 
      success: true, 
      message: 'Payment verified successfully',
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to verify payment',
      details: error.message || 'Unknown error'
    });
  }
});

// Add this near the top of your routes
app.get('/cors-test', (req, res) => {
  // Log the origin
  console.log('Request origin:', req.headers.origin);
  
  // Set explicit CORS headers for this route
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  
  // Send a simple response
  res.json({ 
    success: true, 
    message: 'CORS test successful',
    receivedOrigin: req.headers.origin
  });
});

// Add these new endpoints for subscription handling

// Create a subscription
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { plan_id, user_id, total_count = 12 } = req.body;

    if (!plan_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    // Get current date
    const start_at = Math.floor(Date.now() / 1000);
    
    // Create subscription with billing cycle details
    const subscription = await razorpay.subscriptions.create({
      plan_id: plan_id,
      total_count: total_count,
      quantity: 1,
      customer_notify: 1,
      start_at: start_at,
      notes: {
        user_id: user_id
      },
      notify_info: {
        notify_phone: "",
        notify_email: ""
      }
    });

    // Calculate next billing date (30 days from start)
    const nextBillingDate = new Date((start_at + (30 * 24 * 60 * 60)) * 1000);
    const currentEnd = start_at + (30 * 24 * 60 * 60);

    // Update user in Firebase
    const db = admin.firestore();
    await db.collection('users').doc(user_id).update({
      'subscription.id': subscription.id,
      'subscription.status': 'created',
      'subscription.plan': plan_id,
      'subscription.startedAt': admin.firestore.FieldValue.serverTimestamp(),
      'subscription.nextBillingDate': nextBillingDate,
      'subscription.startAt': start_at,
      'subscription.currentEnd': currentEnd,
      'subscription.type': 'monthly'
    });

    // Return subscription data with billing dates
    res.json({ 
      success: true, 
      data: {
        ...subscription,
        nextBillingDate,
        currentEnd,
        formattedNextBilling: nextBillingDate.toISOString(),
        formattedCurrentEnd: new Date(currentEnd * 1000).toISOString()
      }
    });

  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create subscription',
      details: error.message 
    });
  }
});

// Verify subscription payment
app.post('/api/verify-subscription', async (req, res) => {
  try {
    const { 
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature 
    } = req.body;

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    // Verify the signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid signature' 
      });
    }

    // Get subscription details from Razorpay
    const subscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);
    
    // Calculate next billing date from current_end
    const nextBillingDate = new Date(subscription.current_end * 1000);
    
    // Update user in Firebase
    const userId = subscription.notes.user_id;
    const db = admin.firestore();
    
    await db.collection('users').doc(userId).update({
      'subscription.id': razorpay_subscription_id,
      'subscription.status': 'active',
      'subscription.plan': subscription.plan_id,
      'subscription.startedAt': admin.firestore.FieldValue.serverTimestamp(),
      'subscription.nextBillingDate': nextBillingDate,
      'subscription.currentEnd': subscription.current_end,
      'subscription.type': 'monthly',
      'subscription.paymentId': razorpay_payment_id,
      credits: admin.firestore.FieldValue.increment(getPlanCredits(subscription.plan_id))
    });

    res.json({ 
      success: true, 
      message: 'Subscription verified and activated',
      nextBillingDate: nextBillingDate,
      currentEnd: subscription.current_end,
      formattedNextBilling: nextBillingDate.toISOString()
    });
  } catch (error) {
    console.error('Error verifying subscription:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to verify subscription',
      details: error.message 
    });
  }
});

// Update the webhook endpoint to properly parse and respond
app.post('/api/webhooks/razorpay', express.json(), async (req, res) => {
  try {
    // Log the incoming request for debugging
    console.log('Webhook received:', {
      headers: req.headers,
      body: req.body
    });

    const webhook_secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhook_secret) {
      console.error('Webhook secret not found in environment variables');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    console.log('Using webhook secret:', webhook_secret.substring(0, 10) + '...');

    const shasum = crypto.createHmac('sha256', webhook_secret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');

    // Verify webhook signature
    if (digest !== req.headers['x-razorpay-signature']) {
      console.log('Invalid signature');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const { event, payload } = req.body;
    console.log('Processing event:', event);

    switch (event) {
      case 'subscription.charged':
        await handleSubscriptionCharged(payload);
        break;
      case 'subscription.cancelled':
        await handleSubscriptionCancelled(payload);
        break;
      case 'subscription.paused':
        await handleSubscriptionPaused(payload);
        break;
      case 'subscription.resumed':
        await handleSubscriptionResumed(payload);
        break;
    }

    // Send a proper JSON response
    res.status(200).json({ 
      status: 'success',
      message: 'Webhook processed successfully'
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message 
    });
  }
});

// Add this new endpoint
app.post('/api/cancel-subscription', async (req, res) => {
  try {
    const { subscription_id, user_id } = req.body;

    if (!subscription_id || !user_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing subscription_id or user_id' 
      });
    }

    // Cancel subscription in Razorpay
    const subscription = await razorpay.subscriptions.cancel(subscription_id);

    // Update user in Firebase
    const db = admin.firestore();
    await db.collection('users').doc(user_id).update({
      'subscription.status': 'cancelled',
      'subscription.cancelledAt': admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ 
      success: true, 
      message: 'Subscription cancelled successfully',
      data: subscription
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to cancel subscription',
      details: error.message 
    });
  }
});

// Helper functions
function getPlanCredits(planId) {
  const planCredits = {
    'plan_Q30DrDwrdv5sUN': 10,  // Starter
    'plan_Q30G5R2vlZl9XS': 50,  // Basic
    'plan_Q30GQUMPYLZMYj': 150  // Pro
  };
  return planCredits[planId] || 0;
}

async function handleSubscriptionCharged(payload) {
  const db = admin.firestore();
  const userId = payload.subscription.notes.user_id;
  const planId = payload.subscription.plan_id;
  const nextBillingDate = new Date(payload.subscription.current_end * 1000);

  await db.collection('users').doc(userId).update({
    'subscription.nextBillingDate': nextBillingDate,
    'subscription.currentEnd': payload.subscription.current_end,
    'subscription.lastChargeDate': admin.firestore.FieldValue.serverTimestamp(),
    credits: admin.firestore.FieldValue.increment(getPlanCredits(planId))
  });
}

async function handleSubscriptionCancelled(payload) {
  const db = admin.firestore();
  const userId = payload.subscription.notes.user_id;

  await db.collection('users').doc(userId).update({
    'subscription.status': 'cancelled',
    'subscription.cancelledAt': admin.firestore.FieldValue.serverTimestamp()
  });
}

async function handleSubscriptionPaused(payload) {
  const db = admin.firestore();
  const userId = payload.subscription.notes.user_id;

  await db.collection('users').doc(userId).update({
    'subscription.status': 'paused',
    'subscription.pausedAt': admin.firestore.FieldValue.serverTimestamp()
  });
}

async function handleSubscriptionResumed(payload) {
  const db = admin.firestore();
  const userId = payload.subscription.notes.user_id;

  await db.collection('users').doc(userId).update({
    'subscription.status': 'active',
    'subscription.resumedAt': admin.firestore.FieldValue.serverTimestamp()
  });
}

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  server.close(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  server.close(() => {
    process.exit(1);
  });
});
