import mongoose from 'mongoose';
import config from './src/config/index.js';
import User from './src/models/User.model.js';
import QuizAttempt from './src/models/QuizAttempt.model.js';
import Winner from './src/models/Winner.model.js';

async function cleanup() {
  try {
    console.log('🧹 Cleaning up old test data...\n');
    
    await mongoose.connect(config.database.url);
    console.log('✅ Connected to MongoDB\n');

    // Delete old test users (all except john.smith, michael.johnson, david.williams, james.brown, sarah.davis)
    const oldUsersResult = await User.deleteMany({
      email: {
        $nin: [
          'john.smith@yopmail.com',
          'michael.johnson@yopmail.com',
          'david.williams@yopmail.com',
          'james.brown@yopmail.com',
          'sarah.davis@yopmail.com'
        ]
      },
      name: { $regex: 'Test$' }
    });

    // Delete all attempts for week 21, 2026
    const attemptsResult = await QuizAttempt.deleteMany({ weekNumber: 21, year: 2026 });

    // Delete all winners for week 21, 2026
    const winnersResult = await Winner.deleteMany({ weekNumber: 21, year: 2026 });

    console.log('✅ Cleanup complete:');
    console.log(`   - Deleted ${oldUsersResult.deletedCount} old test users`);
    console.log(`   - Deleted ${attemptsResult.deletedCount} quiz attempts`);
    console.log(`   - Deleted ${winnersResult.deletedCount} winner records\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

cleanup();
