import dotenv from "dotenv";
dotenv.config();

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

// Exact characters dekho
console.log("Key ID length:", key_id?.length);
console.log("Key ID chars:", JSON.stringify(key_id));
console.log("Secret length:", key_secret?.length);
console.log("Secret chars:", JSON.stringify(key_secret));

// Clean karo
const cleanId = key_id?.trim().replace(/['"]/g, "");
const cleanSecret = key_secret?.trim().replace(/['"]/g, "");

console.log("\nClean Key ID:", cleanId);
console.log("Clean Secret exists:", !!cleanSecret);

const auth = Buffer.from(`${cleanId}:${cleanSecret}`).toString("base64");

const response = await fetch("https://api.razorpay.com/v1/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Basic ${auth}`,
  },
  body: JSON.stringify({
    amount: 50000,
    currency: "INR",
    receipt: "receipt1",
  }),
});

console.log("\nHTTP Status:", response.status);
const rawText = await response.text();
console.log("Raw Response:", rawText);