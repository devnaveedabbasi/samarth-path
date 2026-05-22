import axios from 'axios';

export async function sendOtpSms(phone, otp) {
  try {
    const response = await axios.get(
      "https://www.fast2sms.com/dev/bulkV2",
      {
        params: {
          authorization: process.env.FAST2SMS_API_KEY,
          route: "dlt",
          sender_id: process.env.FAST2SMS_SENDER_ID,  // Add this
          message: process.env.FAST2SMS_MESSAGE_ID,    // Use template ID, not raw text
          variables_values: otp,                       // Pass OTP as variable
          language: "english",
          flash: 0,
          numbers: phone,
        }
      }
    );

    console.log("SMS sent:", response.data);
    return response.data;
  } catch (error) {
    console.error("SMS Error:", error.response?.data || error.message);
    throw new Error("Failed to send OTP SMS");
  }
}