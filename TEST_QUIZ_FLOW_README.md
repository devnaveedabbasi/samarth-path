# 🎯 Quiz Winners Flow - Test Instructions

## Overview
This test simulates a complete 7-day quiz flow with multiple users, score calculation, and winner announcement with email notifications to yopmail.

## 📋 What the Test Does

### Flow Steps:
1. **Create Test Users** (5 users)
   - Automatically generates unique yopmail email addresses
   - Creates users with "approved" status

2. **Create 7 Days of Quizzes**
   - Creates one quiz per day for 7 days
   - Each quiz has 3 options with 1 correct answer
   - Includes explanations and timer

3. **Simulate Quiz Attempts**
   - Each user attempts all 7 quizzes
   - Predefined patterns to show scoring algorithm:
     - User 1: 4 correct answers (Rank 1 - Winner 🥇)
     - User 2: 3 correct answers (Rank 2 - Runner up 🥈)
     - User 3: 2 correct answers (Rank 3 - Third place 🥉)
     - User 4: 1 correct answer
     - User 5: 0 correct answers

4. **Announce Winners**
   - Calls `/api/v1/winners/announce-winners` endpoint
   - Saves top 3 to Winner collection
   - Sends notifications + emails

5. **Verify Results**
   - Shows final rankings
   - Displays winner details in database
   - Provides yopmail email verification URLs

---

##  How to Run the Test

### Prerequisites:
- MongoDB running locally or remote connection configured
- Backend server running on `http://localhost:5000`
- Admin user already exists in database

### Step 1: Stop any running backend server
```bash
# If a dev server is running, stop it first
# Then make sure you're in the smarth-path directory
cd d:\Naveed Abbasi\TRB\smarth\smarth-path
```

### Step 2: Ensure backend is running
```bash
npm run dev
# OR if that's not the correct script:
npm start
```

Wait for the server to show it's listening on port 5000.

### Step 3: Run the test script (in a new terminal)
```bash
cd d:\Naveed Abbasi\TRB\smarth\smarth-path

# Run with Node
node test-quiz-flow.js
```

---

## 📊 Expected Output

```
 ═══════════════════════════════════════════════════════════
   QUIZ WINNERS - COMPLETE FLOW TEST
═══════════════════════════════════════════════════════════

 Connecting to MongoDB...
✅ MongoDB connected

📝 STEP 1: Creating Test Users...
✅ Created user: Hamza Baloch Test (hamza-1234567890@yopmail.com)
✅ Created user: Ali Khan Test (ali-1234567890@yopmail.com)
...

📚 STEP 2: Creating 7 Days of Quiz Content...
✅ Day 1: JavaScript Basics (Sun May 12 2026)
✅ Day 2: React Concepts (Mon May 13 2026)
...

🎯 STEP 3: Simulating 7 Days of Quiz Attempts...
  ✅ Hamza Baloch Test - Day 1: JavaScript Basics (Correct)
  ❌ Hamza Baloch Test - Day 2: React Concepts (Wrong)
...

🏆 STEP 4: Current Rankings Before Winner Announcement...
🥇 #1  | Hamza Baloch Test       | 4 points | 4/7 questions
🥈 #2  | Ali Khan Test           | 3 points | 3/7 questions
🥉 #3  | Dhruv Rathe Test        | 2 points | 2/7 questions
   #4  | Kasab Test              | 1 point  | 1/7 questions
   #5  | Sara Ahmed Test         | 0 points | 0/7 questions

📢 STEP 5: Announcing Weekly Winners...
✅ Winner announcement API called

🔍 STEP 6: Verifying Winners in Database...
✅ Found 3 winners:
🥇 Rank #1: Hamza Baloch Test (hamza-1234567890@yopmail.com) - Score: 4
🥈 Rank #2: Ali Khan Test (ali-1234567890@yopmail.com) - Score: 3
🥉 Rank #3: Dhruv Rathe Test (dhruv-1234567890@yopmail.com) - Score: 2

📧 STEP 7: Winners Email Addresses for Verification...
Check these yopmail inbox URLs for winner notifications:

  👤 Hamza Baloch Test (Rank #1)
     📧 Email: hamza-1234567890@yopmail.com
      Check inbox: https://yopmail.com/hamza-1234567890

  👤 Ali Khan Test (Rank #2)
     📧 Email: ali-1234567890@yopmail.com
      Check inbox: https://yopmail.com/ali-1234567890

  👤 Dhruv Rathe Test (Rank #3)
     📧 Email: dhruv-1234567890@yopmail.com
      Check inbox: https://yopmail.com/dhruv-1234567890

✅ ═══════════════════════════════════════════════════════════
   TEST COMPLETED SUCCESSFULLY!
═══════════════════════════════════════════════════════════
```

---

## 🧪 Scoring Algorithm Verified

The test validates that winners are selected using:

```javascript
// Algorithm:
1. Count CORRECT answers only (isCorrect: true)
2. Group by user
3. Sort by:
   - Score DESC (highest correct answers first)
   - FirstAttemptTime ASC (earliest attempt wins ties)
4. Take top 3 as winners
```

**Example from test:**
- Hamza: 4 correct → Rank 1 🥇
- Ali: 3 correct → Rank 2 🥈
- Dhruv: 2 correct → Rank 3 🥉

---

## 📧 Checking Email Notifications

### Using Yopmail (Temporary Email Service):

1. Copy one of the yopmail URLs from the test output
2. Open in browser: `https://yopmail.com/hamza-1234567890`
3. You should see winner notification email

### Email Content:
The winner notification email includes:
- ✅ User's rank (1st, 2nd, or 3rd)
- 🎯 Week number and year
- 📊 Final score

---

## 🔄 Resetting Test Data

If you run the test multiple times and want fresh data:

```bash
# In MongoDB:
db.users.deleteMany({ name: /Test$/ })
db.contents.deleteMany({ "quizContent.title": /Day [1-7]/ })
db.quizattempts.deleteMany({})
db.winners.deleteMany({ weekNumber: 21, year: 2026 })
```

Or modify the test script to use a different week number.

---

## 🐛 Troubleshooting

### Error: "No admin user found"
- Create an admin user in database first
- Or modify test to use first available user

### Error: "Cannot connect to MongoDB"
- Ensure MongoDB is running
- Check connection string in `config/index.js`

### Error: "ECONNREFUSED http://localhost:5000"
- Backend server is not running
- Run `npm run dev` in the smarth-path directory

### Emails not showing in yopmail
- Yopmail may have delivery delays
- Wait a few seconds and refresh
- Check spam folder

---

## 📌 Notes

- Test creates unique users each run (prevents duplicates)
- Quiz dates are automatically set for past 7 days
- All week/year values are hardcoded to week 21, 2026
- Test data is idempotent (safe to run multiple times)
- Emails are sent immediately after winner announcement

---

## ✅ What Gets Tested

- ✅ User creation with approval status
- ✅ Quiz content creation with proper structure
- ✅ Quiz attempt recording with correct/wrong tracking
- ✅ Score calculation (only correct answers count)
- ✅ Ranking algorithm (score DESC, time ASC)
- ✅ Top 3 winner selection
- ✅ Winner database persistence
- ✅ Email notifications to winners
- ✅ API response validation
- ✅ Fallback logic when no official winners exist

---

**Created:** May 20, 2026
**Test Duration:** ~30 seconds
**Database:** MongoDB
**Email Service:** Yopmail (temporary emails)
