export async function sendOtpSms(phone, otp) {
  // TODO: Replace this with a real SMS provider integration.
  // Example providers: Twilio, Nexmo, MSG91, etc.
  // For now we log the OTP so the backend flow can be tested.
  console.log(`Sending OTP to ${phone}: ${otp}`);
}
