import axios from 'axios';

export async function sendOtpSms(phone, otp) {
  try {
    const response = await axios.get(
      "https://www.fast2sms.com/dev/bulkV2",
      {
        params: {
          authorization: process.env.FAST2SMS_API_KEY,
          route: "q",                         
          message: `Your OTP is ${otp}. Valid for 5 minutes.`,
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