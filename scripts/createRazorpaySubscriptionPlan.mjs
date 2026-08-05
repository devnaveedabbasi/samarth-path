// One-time setup script — creates the recurring ₹199 / 30-day Razorpay Plan.

import dotenv from 'dotenv';

dotenv.config();

const key_id = process.env.RAZORPAY_KEY_ID?.trim();
const key_secret = process.env.RAZORPAY_KEY_SECRET?.trim();

if (!key_id || !key_secret) {
  console.error('❌ RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing from .env');
  process.exit(1);
}

const auth = Buffer.from(`${key_id}:${key_secret}`).toString('base64');

const response = await fetch('https://api.razorpay.com/v1/plans', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Basic ${auth}`,
  },
  body: JSON.stringify({
    period: 'monthly',
    interval: 1,
    item: {
      name: 'Monthly Basic',
      amount: 19900,
      currency: 'INR',
      description: 'Recurring ₹199 every month',
    },
  }),
});

const rawBody = await response.text();

console.log('Status:', response.status);
console.log('Raw Response:', rawBody);

let body = {};

try {
  body = rawBody ? JSON.parse(rawBody) : {};
} catch {
  console.error('❌ Razorpay returned invalid JSON:', rawBody);
  process.exit(1);
}

if (!response.ok) {
  console.error(
    '❌ Failed to create plan:',
    response.status,
    JSON.stringify(body, null, 2)
  );
  process.exit(1);
}

console.log('✅ Plan created successfully.');
console.log('plan_id:', body.id);
console.log('\nAdd this to your .env:');
console.log(`RAZORPAY_PLAN_ID=${body.id}`);