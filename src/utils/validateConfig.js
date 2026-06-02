/**
 * Configuration Validation Utility
 * Checks critical environment variables and configurations on application startup
 */

export function validateRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  console.log('\n🔍 Validating Razorpay Configuration...');

  if (!keyId) {
    console.error('❌ RAZORPAY_KEY_ID is not set in .env file');
    return false;
  }

  if (!keySecret) {
    console.error('❌ RAZORPAY_KEY_SECRET is not set in .env file');
    return false;
  }

  // Check minimum key length (Razorpay keys are typically 40+ characters)
  if (keyId.length < 20) {
    console.warn('⚠️  RAZORPAY_KEY_ID seems too short (< 20 chars). Current length:', keyId.length);
    console.warn('   This might cause authentication failures. Check your .env file.');
  }

  if (keySecret.length < 20) {
    console.error('❌ RAZORPAY_KEY_SECRET seems truncated (< 20 chars). Current length:', keySecret.length);
    console.error('   Razorpay secret keys are typically 40+ characters.');
    console.error('   Please update your .env file with the complete secret key.');
    return false;
  }

  // Check format
  if (!keyId.startsWith('rzp_test_') && !keyId.startsWith('rzp_live_')) {
    console.warn('⚠️  RAZORPAY_KEY_ID format unusual. Expected to start with "rzp_test_" or "rzp_live_"');
  }

  if (!keySecret.startsWith('rzp_test_') && !keySecret.startsWith('rzp_live_')) {
    console.warn('⚠️  RAZORPAY_KEY_SECRET format unusual. Expected to start with "rzp_test_" or "rzp_live_"');
  }

  const mode = keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST';
  console.log('✅ Razorpay Configuration Valid');
  console.log(`   Mode: ${mode}`);
  console.log(`   Key ID Length: ${keyId.length}`);
  console.log(`   Key Secret Length: ${keySecret.length}`);
  console.log('');

  return true;
}

export function validateAllConfigs() {
  console.log('\n📋 Starting Configuration Validation...\n');

  let allValid = true;

  // Validate Razorpay
  try {
    if (!validateRazorpayConfig()) {
      allValid = false;
    }
  } catch (error) {
    console.error('❌ Error validating Razorpay config:', error.message);
    allValid = false;
  }

  // Check other critical configs
  const criticalEnvVars = ['MONGODB_URI', 'JWT_SECRET'];
  for (const envVar of criticalEnvVars) {
    if (!process.env[envVar]) {
      console.warn(`⚠️  ${envVar} is not set`);
    } else {
      console.log(`✅ ${envVar} is configured`);
    }
  }

  console.log('\n' + '='.repeat(50) + '\n');

  if (!allValid) {
    console.warn('⚠️  Some configuration issues were found. Payment functionality may not work correctly.');
    console.warn('Please check your .env file and restart the application.\n');
  } else {
    console.log('✅ All critical configurations are valid!\n');
  }

  return allValid;
}
