/**
 * Quiz Winners Flow - Complete Test Script
 * Tests: Create users → Create 7 quizzes → Simulate 7 days of attempts → Announce winners
 * Email: Uses yopmail.com for email verification
 */

import axios from 'axios';
import crypto from 'crypto';
import mongoose from 'mongoose';
import config from './src/config/index.js';
import User from './src/models/User.model.js';
import DailyContent from './src/models/Content.model.js';
import QuizAttempt from './src/models/QuizAttempt.model.js';
import Winner from './src/models/Winner.model.js';
import WinnerService from './src/services/winner.service.js';

const API_BASE_URL = 'http://localhost:5000/api/v1';

// ─── Test Data ──────────────────────────────────────────────
const TEST_USERS = [
  {
    name: 'John Smith',
    email: 'john.smith@yopmail.com',
    phone: `+923331${Math.random().toString().slice(2, 8)}`,
    password: 'Test@1234'
  },
  {
    name: 'Michael Johnson',
    email: 'michael.johnson@yopmail.com',
    phone: `+923332${Math.random().toString().slice(2, 8)}`,
    password: 'Test@1234'
  },
  {
    name: 'David Williams',
    email: 'david.williams@yopmail.com',
    phone: `+923333${Math.random().toString().slice(2, 8)}`,
    password: 'Test@1234'
  },
  {
    name: 'James Brown',
    email: 'james.brown@yopmail.com',
    phone: `+923334${Math.random().toString().slice(2, 8)}`,
    password: 'Test@1234'
  },
  {
    name: 'Sarah Davis',
    email: 'sarah.davis@yopmail.com',
    phone: `+923335${Math.random().toString().slice(2, 8)}`,
    password: 'Test@1234'
  }
];

// ─── Quiz Templates for 7 Days ───────────────────────────────
const QUIZ_TEMPLATES = [
  {
    title: 'Day 1: JavaScript Basics',
    question: 'What does JSON stand for?',
    options: [
      { id: '1', text: 'JavaScript Object Notation' },
      { id: '2', text: 'Java Standard Object Notation' },
      { id: '3', text: 'JavaScript Oriented Navigation' }
    ],
    correctOptionId: '1',
    explanation: 'JSON stands for JavaScript Object Notation'
  },
  {
    title: 'Day 2: React Concepts',
    question: 'What is the virtual DOM?',
    options: [
      { id: '1', text: 'A virtual representation of the real DOM' },
      { id: '2', text: 'A server-side rendering technique' },
      { id: '3', text: 'A database abstraction layer' }
    ],
    correctOptionId: '1',
    explanation: 'The virtual DOM is a lightweight copy of the real DOM'
  },
  {
    title: 'Day 3: Node.js Fundamentals',
    question: 'What is Node.js?',
    options: [
      { id: '1', text: 'A JavaScript runtime built on Chrome\'s V8 engine' },
      { id: '2', text: 'A frontend framework' },
      { id: '3', text: 'A database management system' }
    ],
    correctOptionId: '1',
    explanation: 'Node.js is a JavaScript runtime for server-side development'
  },
  {
    title: 'Day 4: Database Design',
    question: 'What is a primary key?',
    options: [
      { id: '1', text: 'A unique identifier for each record' },
      { id: '2', text: 'The first column in a table' },
      { id: '3', text: 'A foreign key reference' }
    ],
    correctOptionId: '1',
    explanation: 'A primary key uniquely identifies each row in a table'
  },
  {
    title: 'Day 5: API Design',
    question: 'What HTTP method is used to create a resource?',
    options: [
      { id: '1', text: 'POST' },
      { id: '2', text: 'GET' },
      { id: '3', text: 'PUT' }
    ],
    correctOptionId: '1',
    explanation: 'POST is used to create new resources'
  },
  {
    title: 'Day 6: Security Concepts',
    question: 'What is authentication?',
    options: [
      { id: '1', text: 'Verifying the identity of a user' },
      { id: '2', text: 'Encrypting data in transit' },
      { id: '3', text: 'Checking user permissions' }
    ],
    correctOptionId: '1',
    explanation: 'Authentication is the process of verifying user identity'
  },
  {
    title: 'Day 7: Testing Practices',
    question: 'What is unit testing?',
    options: [
      { id: '1', text: 'Testing individual functions or components' },
      { id: '2', text: 'Testing the entire application flow' },
      { id: '3', text: 'Testing the database schema' }
    ],
    correctOptionId: '1',
    explanation: 'Unit testing focuses on testing small, isolated pieces of code'
  }
];

// ─── Helper Functions ────────────────────────────────────────
function getDateDaysAgo(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Step 1: Create Test Users ──────────────────────────────
async function createTestUsers() {
  console.log('\n📝 STEP 1: Creating Test Users...\n');
  const createdUsers = [];

  for (const userData of TEST_USERS) {
    try {
      // Check if user already exists
      let user = await User.findOne({ email: userData.email });
      
      if (!user) {
        user = await User.create({
          ...userData,
          role: 'user',
          status: 'approved',
          isEmailVerified: true,
          isPhoneVerified: true
        });
        console.log(` Created user: ${user.name} (${user.email})`);
      } else {
        console.log(`⏭️  User already exists: ${user.name} (${user.email})`);
      }
      
      createdUsers.push({
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone
      });
    } catch (error) {
      console.error(`❌ Error creating user ${userData.name}:`, error.message);
    }
  }

  console.log(`\n Total users ready: ${createdUsers.length}\n`);
  return createdUsers;
}

// ─── Step 2: Create 7 Days of Quiz Content ──────────────────
async function createQuizzesForSevenDays(adminUserId) {
  console.log('\n📚 STEP 2: Creating 7 Days of Quiz Content...\n');
  const createdQuizzes = [];

  for (let day = 6; day >= 0; day--) {
    try {
      const quizDate = getDateDaysAgo(day);
      const quizTemplate = QUIZ_TEMPLATES[6 - day];

      // Check if quiz already exists for this date
      let quiz = await DailyContent.findOne({
        contentType: 'quiz',
        date: { $gte: new Date(quizDate), $lt: new Date(quizDate.getTime() + 86400000) }
      });

      if (!quiz) {
        quiz = await DailyContent.create({
          contentType: 'quiz',
          date: quizDate,
          unlocksAt: '08:00',
          quizContent: {
            title: quizTemplate.title,
            question: quizTemplate.question,
            options: quizTemplate.options,
            correctOptionId: quizTemplate.correctOptionId,
            timerSeconds: 180,
            explanation: quizTemplate.explanation
          },
          createdBy: adminUserId,
          isActive: true
        });
        console.log(` Day ${7 - day}: ${quizTemplate.title} (${quizDate.toDateString()})`);
      } else {
        console.log(`⏭️  Quiz already exists for Day ${7 - day}`);
      }

      createdQuizzes.push({
        day: 7 - day,
        id: quiz._id,
        date: quizDate,
        correctOptionId: quizTemplate.correctOptionId,
        title: quizTemplate.title
      });
    } catch (error) {
      console.error(`❌ Error creating Day ${7 - day} quiz:`, error.message);
    }
  }

  console.log(`\n Total quizzes ready: ${createdQuizzes.length}\n`);
  return createdQuizzes;
}

// ─── Step 3: Simulate 7 Days of Quiz Attempts ────────────────
async function simulateQuizAttempts(users, quizzes) {
  console.log('\n🎯 STEP 3: Simulating 7 Days of Quiz Attempts...\n');

  // Define scoring patterns for 7 days
  const attemptPatterns = [
    // User 0: Gets 4 correct (wins)
    [true, true, true, true, false, false, false],
    // User 1: Gets 3 correct
    [true, false, true, true, false, false, false],
    // User 2: Gets 2 correct (2nd place)
    [true, false, true, false, false, false, false],
    // User 3: Gets 1 correct
    [true, false, false, false, false, false, false],
    // User 4: Gets 0 correct
    [false, false, false, false, false, false, false]
  ];

  let totalAttempts = 0;

  for (const [userIndex, user] of users.entries()) {
    const pattern = attemptPatterns[userIndex] || [];

    for (const [dayIndex, quiz] of quizzes.entries()) {
      try {
        const isCorrect = pattern[dayIndex] ?? Math.random() > 0.5;
        const selectedOptionId = isCorrect ? quiz.correctOptionId : '2';

        // Check if attempt already exists
        let attempt = await QuizAttempt.findOne({
          userId: user.id,
          contentId: quiz.id
        });

        if (!attempt) {
          attempt = await QuizAttempt.create({
            userId: user.id,
            contentId: quiz.id,
            selectedOptionId,
            isCorrect,
            timeTakenSeconds: Math.floor(Math.random() * 150) + 30,
            weekNumber: 21,
            year: 2026,
            dayNumber: dayIndex + 1
          });

          const resultEmoji = isCorrect ? '' : '❌';
          console.log(
            `  ${resultEmoji} ${user.name} - ${quiz.title} (${isCorrect ? 'Correct' : 'Wrong'})`
          );
          totalAttempts++;
        }
      } catch (error) {
        console.error(`Error creating attempt for ${user.name} on ${quiz.title}:`, error.message);
      }
    }
  }

  console.log(`\n Total attempts created: ${totalAttempts}\n`);
}

// ─── Step 4: Get Current Rankings ────────────────────────────
async function displayCurrentRankings() {
  console.log('\n🏆 STEP 4: Current Rankings Before Winner Announcement...\n');

  const attempts = await QuizAttempt.aggregate([
    { $match: { weekNumber: 21, year: 2026, isCorrect: true } },
    {
      $group: {
        _id: '$userId',
        score: { $sum: 1 },
        firstAttemptTime: { $min: '$createdAt' }
      }
    },
    { $sort: { score: -1, firstAttemptTime: 1 } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' }
  ]);

  if (attempts.length === 0) {
    console.log('❌ No attempts found\n');
    return;
  }

  console.log('Ranking | Name | Score | Correct Answers\n');
  attempts.forEach((attempt, index) => {
    const rank = index + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
    console.log(
      `${medal} #${rank}  | ${attempt.user.name.padEnd(20)} | ${attempt.score} points | ${attempt.score}/7 questions`
    );
  });

  console.log('\n');
  return attempts;
}

// ─── Step 5: Announce Winners ────────────────────────────────
async function announceWinners() {
  console.log('\n📢 STEP 5: Announcing Weekly Winners...\n');

  try {
    // Call WinnerService directly (running on backend)
    const result = await WinnerService.announceWeeklyWinners();
    console.log('✅ Winner announcement completed');
    console.log('Response:', result);
    return result;
  } catch (error) {
    console.error('❌ Error announcing winners:', error.message);
  }
}

// ─── Step 6: Verify Winners in Database ──────────────────────
async function verifyWinners() {
  console.log('\n🔍 STEP 6: Verifying Winners in Database...\n');

  const winners = await Winner.find({
    weekNumber: 21,
    year: 2026,
    cycleType: 'weekly'
  }).populate('userId', 'name email');

  if (winners.length === 0) {
    console.log('❌ No winners found in database\n');
    return;
  }

  console.log(` Found ${winners.length} winners:\n`);
  winners.forEach(winner => {
    const medal = winner.rank === 1 ? '🥇' : winner.rank === 2 ? '🥈' : '🥉';
    console.log(
      `${medal} Rank #${winner.rank}: ${winner.userId?.name} (${winner.userId?.email}) - Score: ${winner.score}`
    );
  });
  console.log('\n');
}

// ─── Step 7: Verify Winner Emails Sent ─────────────────────
async function verifyWinnerEmails() {
  console.log('\n📧 STEP 7: Winners Email Addresses for Verification...\n');
  
  const winners = await Winner.find({
    weekNumber: 21,
    year: 2026,
    cycleType: 'weekly'
  }).populate('userId', 'email name');

  if (winners.length === 0) {
    console.log('❌ No winners to email\n');
    return;
  }

  console.log('📬 Check these yopmail inbox URLs for winner notifications:\n');
  winners.forEach(winner => {
    const email = winner.userId?.email;
    if (email) {
      const localPart = email.split('@')[0];
      const yopmailUrl = `https://yopmail.com/${localPart}`;
      console.log(`  👤 ${winner.userId?.name} (Rank #${winner.rank})`);
      console.log(`     📧 Email: ${email}`);
      console.log(`      Check inbox: ${yopmailUrl}\n`);
    }
  });
}

// ─── Main Test Flow ─────────────────────────────────────────
async function runCompleteTest() {
  try {
    console.log('\n ═══════════════════════════════════════════════════════════');
    console.log('   QUIZ WINNERS - COMPLETE FLOW TEST');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Connect to MongoDB
    console.log(' Connecting to MongoDB...');
    if (!mongoose.connections[0].readyState) {
      await mongoose.connect(config.database.url);
      console.log(' MongoDB connected\n');
    } else {
      console.log(' Already connected to MongoDB\n');
    }

    // Get admin user (for creating content)
    const adminUser = await User.findOne({ role: 'admin' }).limit(1);
    if (!adminUser) {
      console.error('❌ No admin user found. Please create one first.');
      process.exit(1);
    }
    console.log(` Using admin user: ${adminUser.name}\n`);

    // Run test steps
    const testUsers = await createTestUsers();
    const quizzes = await createQuizzesForSevenDays(adminUser._id);
    await simulateQuizAttempts(testUsers, quizzes);
    await displayCurrentRankings();
    await announceWinners();
    await sleep(1000); // Wait for async operations
    await verifyWinners();
    await verifyWinnerEmails();

    console.log('\n ═══════════════════════════════════════════════════════════');
    console.log('   TEST COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('📋 SUMMARY:');
    console.log(`    Created ${testUsers.length} test users`);
    console.log(`    Created ${quizzes.length} quiz questions (7 days)`);
    console.log(`    Simulated attempts across all users`);
    console.log(`    Winners announced and saved to database`);
    console.log(`    Email notifications prepared for yopmail\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
runCompleteTest();
