// test-razorpay.mjs — run with: node test-razorpay.mjs
import Razorpay from 'razorpay';

const razorpay = new Razorpay({
  key_id: 'rzp_test_SwLX9wqJpVXeDX',
  key_secret: '0KygsKPPHeahvL5jQWGpS3Lf',
});

try {
  const order = await razorpay.orders.create({
    amount: 19900,
    currency: 'INR',
    receipt: 'test_receipt_1',
  });
  console.log('✅ Success:', order);
} catch (err) {
  console.log('❌ Error:', JSON.stringify(err, null, 2));
}