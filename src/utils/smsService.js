import axios from "axios";

export async function sendOtpSms(phone, otp) {
  try {
    const response = await axios.post(
      "https://www.fast2sms.com/dev/bulkV2",
      {
        route: "otp",
        variables_values: otp,
        numbers: phone,
      },
      {
        headers: {
          authorization: process.env.FAST2SMS_API_KEY, // store in .env
          "Content-Type": "application/json",
        },
      }
    );

    console.log("SMS sent:", response.data);
    return response.data;
  } catch (error) {
    console.error("SMS Error:", error.response?.data || error.message);
    throw new Error("Failed to send OTP SMS");
  }
}