import { db } from '../firebase';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { PaymentApiService } from './payment-api.service';
import { PaymentFetchService } from './payment-fetch.service';
import axios from 'axios';

interface PaymentVerificationResponse {
  success: boolean;
  message: string;
  transactionId?: string;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export class PaymentService {
  static async initializePayment(orderId: string, amount: number): Promise<string> {
    try {
      // Create initial payment record
      await setDoc(doc(db, 'payments', orderId), {
        orderId,
        amount,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        merchantTransactionId: `MT${Date.now()}`,
      });

      return orderId;
    } catch (error) {
      console.error('Failed to initialize payment:', error);
      throw error;
    }
  }

  // Check payment status every 5 seconds for 5 minutes
  static async verifyUPIPayment(orderId: string): Promise<PaymentVerificationResponse> {
    const maxAttempts = 60; // 5 minutes (60 * 5 seconds)
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const checkPayment = async () => {
        try {
          const paymentRef = doc(db, 'payments', orderId);
          const paymentDoc = await getDoc(paymentRef);
          
          if (paymentDoc.exists()) {
            const paymentData = paymentDoc.data();
            if (paymentData.status === 'SUCCESS') {
              resolve({
                success: true,
                message: 'Payment successful',
                transactionId: paymentData.transactionId
              });
              return;
            } else if (paymentData.status === 'FAILED') {
              resolve({
                success: false,
                message: 'Payment failed'
              });
              return;
            }
          }

          attempts++;
          if (attempts >= maxAttempts) {
            resolve({
              success: false,
              message: 'Payment verification timeout'
            });
            return;
          }

          // Check again after 5 seconds
          setTimeout(checkPayment, 5000);
        } catch (error) {
          reject(error);
        }
      };

      checkPayment();
    });
  }

  static async initializeRazorpayPayment(params: {
    amount: number;
    orderId: string;
    userId: string;
    plan: string;
    credits: number;
    onSuccess: (response: any) => void;
    onError: (error: any) => void;
  }): Promise<void> {
    const { amount, orderId, userId, plan, credits, onSuccess, onError } = params;
    
    try {
      // Load Razorpay script
      await this.loadRazorpayScript();
      
      // Create subscription through backend
      const response = await fetch(`${import.meta.env.VITE_PAYMENT_API_URL}/api/create-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan_id: getPlanId(plan), // Helper function to get Razorpay plan ID
          user_id: userId,
          total_count: 12 // 12 months subscription
        })
      });

      const subscriptionData = await response.json();
      
      if (!subscriptionData.success) {
        throw new Error(subscriptionData.error || 'Failed to create subscription');
      }

      // Initialize Razorpay
      const options = {
        key: 'rzp_live_EXb8TNok0CxjBF',
        subscription_id: subscriptionData.data.id,
        name: 'PostSync',
        description: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
        handler: async function(response: any) {
          try {
            // Verify subscription payment
            const verifyResponse = await fetch(`${import.meta.env.VITE_PAYMENT_API_URL}/api/verify-subscription`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_subscription_id: response.razorpay_subscription_id,
                razorpay_signature: response.razorpay_signature
              })
            });

            const verifyData = await verifyResponse.json();
            
            if (verifyData.success) {
              onSuccess(verifyData);
            } else {
              onError(new Error(verifyData.error || 'Payment verification failed'));
            }
          } catch (error) {
            console.error('Error during payment verification:', error);
            onError(error);
          }
        },
        prefill: {
          name: 'User',
          email: 'user@example.com',
          contact: ''
        },
        theme: {
          color: '#3399cc'
        }
      };
      
      const razorpay = new (window as any).Razorpay(options);
      razorpay.open();
      
    } catch (error) {
      console.error('Error initializing payment:', error);
      onError(error);
    }
  }

  private static async loadRazorpayScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).Razorpay) {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = (error) => reject(error);
      document.body.appendChild(script);
    });
  }

  static async cancelSubscription(subscription_id: string, user_id: string) {
    try {
      const response = await fetch(`${import.meta.env.VITE_PAYMENT_API_URL}/api/cancel-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ subscription_id, user_id })
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to cancel subscription');
      }

      return data;
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      throw error;
    }
  }
}

// Helper function to get Razorpay plan ID
function getPlanId(plan: string): string {
  const planIds: { [key: string]: string } = {
    'starter': 'plan_Q30DrDwrdv5sUN',
    'basic': 'plan_Q30G5R2vlZl9XS',
    'pro': 'plan_Q30GQUMPYLZMYj'
  };
  return planIds[plan] || '';
}

export const initializeRazorpayPayment = PaymentService.initializeRazorpayPayment.bind(PaymentService);
