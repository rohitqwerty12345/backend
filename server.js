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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
