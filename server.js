require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const app = express();

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

// Initialize Razorpay with your keys
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || ''
});

// Initialize Firebase Admin with credentials
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Replace newlines in the private key
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Error initializing Firebase Admin:', error);
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

    // Log the request for debugging
    console.log('Creating order with:', {
      amount,
      orderId,
      currency,
      notes
    });
    
    const options = {
      amount: Math.round(amount * 100), // Convert to paise and ensure it's an integer
      currency,
      receipt: orderId,
      notes,
      payment_capture: 1 // Auto capture payment
    };
    
    const order = await razorpay.orders.create(options);
    console.log('Order created:', order);
    
    res.json({
      success: true,
      data: {
        order_id: order.id,
        currency: order.currency,
        amount: order.amount,
        notes: order.notes
      }
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create order',
      details: error.message
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
    const { plan_id, user_id, total_count = 12 } = req.body; // total_count is number of billing cycles

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan_id,
      total_count: total_count,
      quantity: 1,
      customer_notify: 1,
      notes: {
        user_id: user_id
      }
    });

    res.json({ 
      success: true, 
      data: subscription 
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

    // Get subscription details
    const subscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);
    
    // Update user in Firebase
    const userId = subscription.notes.user_id;
    const db = admin.firestore();
    
    await db.collection('users').doc(userId).update({
      'subscription.id': razorpay_subscription_id,
      'subscription.status': 'active',
      'subscription.plan': subscription.plan_id,
      'subscription.startedAt': admin.firestore.FieldValue.serverTimestamp(),
      'subscription.nextBillingDate': new Date(subscription.current_end * 1000),
      credits: admin.firestore.FieldValue.increment(getPlanCredits(subscription.plan_id))
    });

    res.json({ 
      success: true, 
      message: 'Subscription verified and activated' 
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
    console.log('Using webhook secret:', webhook_secret.substring(0, 10) + '...');  // Log first 10 chars for verification

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

  await db.collection('users').doc(userId).update({
    'subscription.nextBillingDate': new Date(payload.subscription.current_end * 1000),
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
    await razorpay.subscriptions.cancel(subscription_id);

    // Update user's subscription status in Firebase
    const db = admin.firestore();
    await db.collection('users').doc(user_id).update({
      'subscription.status': 'cancelled',
      'subscription.cancelledAt': admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ 
      success: true, 
      message: 'Subscription cancelled successfully' 
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
