# Samarth Path - Project Documentation

## Project Overview
Samarth Path ek daily content cycle platform hai jaha users ko 3 tarah ka content daily milta hai:
- **Morning** (8:00 AM): Text posts (large font, comfortable reading)
- **Afternoon** (2:00 PM): Quiz (180-second timer, 4 options)
- **Evening** (7:00 PM): Video (max 7 min, auto-muted)

Users 3 din trial ke baad paid subscription le sakte hain (Rs. 199/month).

---

##  Completed Features

### 1. User Authentication System
**Status**:  Fully Complete

#### Registration Flow:
- User register karta hai: `name`, `phone`, `email`, `password`
- Phone verify hone par SMS OTP bheja jata hai
- Automatically **3-day trial subscription** create hota hai
- User ka password hashed rehta hai (bcryptjs)

**Endpoint**: `POST /api/user/auth/register`
```json
{
  "name": "John Doe",
  "phone": "923001234567",
  "email": "john@example.com",
  "password": "securePass123"
}
```

#### Login Flow:
- `phone` + `password` se login
- Phone verification zaroori hai
- Subscription status check hoti hai
- Valid JWT token return hota hai

**Endpoint**: `POST /api/user/auth/login`
```json
{
  "phone": "923001234567",
  "password": "securePass123"
}
```

#### Forgot Password:
- Phone number par OTP bheja jata hai
- OTP verify karne par password reset ho sakta hai

**Endpoints**:
- `POST /api/user/auth/forgot-password` - OTP send
- `POST /api/user/auth/verify-reset-otp` - OTP verify
- `POST /api/user/auth/set-new-password` - New password set

---

### 2. Subscription System
**Status**:  Fully Complete

#### Models:
- **Subscription.model.js** - Separate collection for subscriptions
  - Fields: userId, status, expiryDate, planName, price, paymentMethod, paymentRef
  - Supports: trial, active, expired, cancelled statuses

- **User.model.js** - Updated with references
  - `isSubscribed`: Boolean flag
  - `subscriptionID`: Reference to Subscription collection

#### Subscription Types:
1. **Trial**: 3 days automatically on registration
2. **Paid**: Rs. 199/month (30 days)

#### Razorpay Payment Integration:
- UPI aur Credit Card se payment
- Signature verification for security

**Endpoints**:
- `POST /api/user/subscription/create-order` - Razorpay order create
- `POST /api/user/subscription/verify-payment` - Payment verify
- `GET /api/user/subscription/status` - Current status check

#### Access Control:
- Trial users ko sirf 3 din access hai
- Expired users ko "subscribe" message dikhta hai
- Subscription expire hone par automatically status update

---

### 3. Daily Content System
**Status**:  Fully Complete

#### DailyContent.model.js Features:
- **3 Content Types**:
  - `text`: Scheduled at 8:00 AM
  - `quiz`: Scheduled at 2:00 PM
  - `video`: Scheduled at 7:00 PM

- **Text Content**:
  - Large font size (customizable)
  - High line spacing for comfort
  - Comfortable reading experience

- **Quiz Content**:
  - Single question with 4 options
  - 180-second countdown timer
  - Correct answer explanation included

- **Video Content**:
  - Max 7 minutes duration
  - Auto-muted on start
  - "Listen Only" mode toggle support

#### Smart Unlock System:
- Content automatically unlock hota hai specific time par
- Frontend ko unlock status malti hai
- Content data sirf unlock hone par visible hota hai

**Endpoint**: `GET /api/daily-content/today`
```json
Response:
{
  "data": [
    {
      "_id": "content_id",
      "contentType": "text",
      "unlocksAt": "08:00",
      "isUnlocked": true,
      "textContent": { ... }
    },
    {
      "_id": "content_id",
      "contentType": "quiz",
      "unlocksAt": "14:00",
      "isUnlocked": false
    },
    {
      "_id": "content_id",
      "contentType": "video",
      "unlocksAt": "19:00",
      "isUnlocked": false
    }
  ]
}
```

---

### 4. User Interactions
**Status**:  Fully Complete

#### Likes System:
- **Model**: Like.model.js (userId, contentId unique constraint)
- User ek content par sirf ek bar like kar sakta hai

**Endpoints**:
- `POST /api/daily-content/like` - Like content
- `POST /api/daily-content/unlike` - Unlike content

#### Comments System:
- **Model**: Comment.model.js (supports nested replies)
- 500 character limit per comment
- User apne comments delete kar sakta hai

**Endpoints**:
- `POST /api/daily-content/comment` - Add comment
- `GET /api/daily-content/comments/:contentId` - Get comments
- `DELETE /api/daily-content/comment` - Delete comment

#### Bookmarks (Save Feature):
- **Model**: Bookmark.model.js
- Private bookmarks - no sharing pressure
- User apne bookmarked content later dekh sakta hai

**Endpoints**:
- `POST /api/daily-content/bookmark` - Bookmark content
- `POST /api/daily-content/remove-bookmark` - Remove bookmark
- `GET /api/daily-content/bookmarks` - Get all bookmarks

---

### 5. Quiz & Scoring System
**Status**:  Fully Complete

#### QuizAttempt.model.js:
- Tracks: userId, contentId, selectedOptionId, isCorrect, timeTaken
- Weekly scoring ke liye: weekNumber, year tracking
- Ek user sirf ek bar ek quiz ko attempt kar sakta hai

#### Features:
1. **Quiz Submission**:
   - Answer submit karte hi feedback milti hai
   - Correct answer green highlight (backend se notification)
   - Incorrect answer red highlight + explanation

2. **Weekly Score Tracking**:
   - Automatically ISO week number calculate hota hai
   - Correct answers count hote hain

3. **Quiz Attempts Control**:
   - Submit button sirf option select hone par active
   - 180-second timer strictly enforce

**Endpoints**:
- `POST /api/daily-content/quiz/submit` - Quiz answer submit
- `GET /api/daily-content/quiz/weekly-score` - Get weekly score

```json
POST /api/daily-content/quiz/submit
{
  "contentId": "quiz_content_id",
  "selectedOptionId": "option_2",
  "timeTakenSeconds": 45
}

Response:
{
  "data": {
    "attemptId": "attempt_id",
    "isCorrect": true,
    "correctOptionId": "option_2",
    "explanation": "This is correct because..."
  },
  "message": "Correct answer!"
}
```

---

### 6. Winners System
**Status**:  Fully Complete

#### Models:
- **Winner.model.js**: Rank, score, weekNumber, year, prizeId
- **Prize.model.js**: Title, description, imageUrl, weekly/daily type

#### Features:
1. **Weekly Winners Calculation**:
   - Auto-calculate top users by correct answers
   - Configurable limit (default 10, via `MAX_WEEKLY_WINNERS` env)
   - Rank automatically assigned (1st, 2nd, 3rd...)

2. **Prize Management**:
   - Weekly prize display
   - Prize image + text
   - Admin can set prize per week

3. **Winners Display**:
   - Current week winners + prize shown
   - Previous week winners accessible
   - Expandable list (default 10, configurable)

**Admin Endpoints**:
- `POST /api/daily-content/winners/calculate` - Calculate weekly winners

**User Endpoints**:
- `GET /api/daily-content/winners/weekly` - Current week winners + prize
- `GET /api/daily-content/winners/previous-week` - Previous week winners

```json
GET /api/daily-content/winners/weekly

Response:
{
  "data": {
    "prize": {
      "title": "Prize Name",
      "description": "Prize description",
      "imageUrl": "https://..."
    },
    "winners": [
      {
        "rank": 1,
        "score": 7,
        "userId": { "name": "User A" }
      },
      {
        "rank": 2,
        "score": 6,
        "userId": { "name": "User B" }
      }
    ],
    "weekNumber": 15,
    "year": 2026
  }
}
```

---

### 7. Archive System
**Status**:  Fully Complete with Restrictions

#### Archive.model.js:
- Tracks: userId, contentId, archivedAt
- Separate collection for fast retrieval

#### Access Control (Role-Based):
1. **Trial Users** (< 3 days old):
   - Only past 3 days ka content dekh sakta hai
   - Older content access denied

2. **Paid Users** (subscribed):
   - Full archive access
   - Pura history available

#### Features:
1. **Calendar View**:
   - Date-based grouping of archived content
   - Trial/paid access indicator

2. **Date-wise Retrieval**:
   - Specific date par kis content ko archive kiya
   - Content metadata with title/question/video info

**Endpoints**:
- `POST /api/daily-content/archive` - Archive content
- `POST /api/daily-content/unarchive` - Unarchive content
- `GET /api/daily-content/archived` - Get archived content
- `GET /api/daily-content/archive/calendar` - Calendar view (restricted)
- `GET /api/daily-content/archive/date/:date` - Get content by date

```json
GET /api/daily-content/archive/calendar

Response (Trial User):
{
  "data": {
    "accessLevel": "limited",
    "startDate": "2026-04-13",
    "archive": {
      "2026-04-16": [ ... ],
      "2026-04-15": [ ... ],
      "2026-04-14": [ ... ]
    }
  }
}

Response (Paid User):
{
  "data": {
    "accessLevel": "full",
    "startDate": null,
    "archive": { ... all dates ... }
  }
}
```

---

## 📁 Project Structure

```
src/
├── models/
│   ├── User.model.js               User auth + subscription ref
│   ├── Subscription.model.js        Separate subscription collection
│   ├── DailyContent.model.js        Text/Quiz/Video content
│   ├── Like.model.js                Likes tracking
│   ├── Comment.model.js             Comments with nesting
│   ├── Bookmark.model.js            Save feature
│   ├── Archive.model.js             Archive tracking
│   ├── QuizAttempt.model.js         Quiz submissions + scoring
│   ├── Winner.model.js              Weekly winners
│   └── Prize.model.js               Prize management
│
├── controllers/
│   ├── user/
│   │   ├── auth.controller.js       Register, login, forgot password
│   │   └── subscription.controller.js  Payment & subscription
│   ├── dailyContent.controller.js   Content + likes + comments
│   ├── quizAndWinners.controller.js  Quiz submission + winners
│   └── bookmarkAndArchive.controller.js  Bookmarks + archive
│
├── routes/
│   ├── index.js                     Main router
│   ├── dailyContent.routes.js       Content routes
│   └── user/
│       ├── auth.routes.js           Auth routes
│       ├── subscription.routes.js   Subscription routes
│       └── index.js                 User router
│
├── middleware/
│   └── auth.js                      Auth + subscription check
│
└── utils/
    ├── asyncHandler.js
    ├── errorHandler.js
    ├── apiResponse.js
    └── smsService.js
```

---

## 🔐 Authentication & Security

1. **JWT Tokens**: Secure token-based auth
2. **Password Hashing**: bcryptjs (10 salt rounds)
3. **OTP Verification**: SMS-based phone verification
4. **Razorpay Signature**: Cryptographic payment verification
5. **Subscription Middleware**: Automatic access control

---

## 📊 API Architecture

### Authentication Flow:
```
1. Register → Create user + trial subscription
   ↓
2. Verify Phone → OTP verification
   ↓
3. Login → Email + password → JWT token
   ↓
4. Access Protected Routes → Token validation + subscription check
```

### Subscription Flow:
```
1. Trial Period (3 days) → Auto-created on registration
   ↓
2. Trial Expires → Status changes to "expired"
   ↓
3. User Creates Order → Razorpay order generation
   ↓
4. Payment Verification → Signature validation
   ↓
5. Active Subscription → 30-day access granted
   ↓
6. Expiry → Auto-update to "expired"
```

### Content Access Flow:
```
1. User requests /daily-content/today
   ↓
2. Check subscription status (active/trial)
   ↓
3. Check if expired → Block access
   ↓
4. Return 3 content cards with unlock status
   ↓
5. Frontend shows/hides based on unlocksAt time
```

---

## 🔄 Key Middleware

1. **authMiddleware**: JWT verification + user loading
2. **checkSubscription**: Validates trial/active subscription
3. **checkFullAccess**: Only allows paid subscriptions
4. **authorize**: Role-based access (user/admin)

---

## 📝 Environment Variables Required

```env
# JWT
JWT_SECRET=your_jwt_secret_here

# Razorpay
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_email_password

# SMS
SMS_API_KEY=your_sms_api_key
SMS_SENDER_ID=your_sender_id

# Optional
MAX_WEEKLY_WINNERS=10  # Can be changed for ranking count
FRONTEND_URL=http://localhost:3000
```

---

##  Current Status

| Feature | Status | Notes |
|---------|--------|-------|
| User Registration |  Complete | Phone verification + trial setup |
| User Login |  Complete | Phone + password based |
| Subscription Management |  Complete | Trial + Razorpay payment |
| Daily Content Cycle |  Complete | 3 types, timed unlock |
| Likes & Comments |  Complete | Full interaction system |
| Bookmarks/Save |  Complete | Private, no sharing |
| Quiz System |  Complete | Scoring + attempt tracking |
| Winners Ranking |  Complete | Weekly calculation |
| Archive System |  Complete | Trial/paid restrictions |
| Access Control |  Complete | Middleware-based |

---

## 📱 Frontend Integration Examples

### 1. Home Screen Today's Content:
```javascript
await fetch('/api/daily-content/today', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### 2. Submit Quiz Answer:
```javascript
await fetch('/api/daily-content/quiz/submit', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    contentId: 'quiz_id',
    selectedOptionId: 'option_1',
    timeTakenSeconds: 45
  })
})
```

### 3. Get Weekly Score:
```javascript
await fetch('/api/daily-content/quiz/weekly-score', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### 4. Get Winners with Prize:
```javascript
await fetch('/api/daily-content/winners/weekly', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### 5. Archive - Calendar View (Trial Restricted):
```javascript
await fetch('/api/daily-content/archive/calendar', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

---

## 🔮 Future Enhancements Possible

1. **Admin Dashboard**:
   - Daily content creation interface
   - Prize management
   - Winner analytics
   - User management

2. **Notifications**:
   - Daily content unlock notifications
   - Quiz submission notifications
   - Winner announcements

3. **Analytics**:
   - User engagement metrics
   - Quiz performance analysis
   - Content popularity tracking

4. **Gamification**:
   - Achievement badges
   - Leaderboards
   - Streaks tracking

5. **Content Recommendations**:
   - Personalized content suggestions
   - Content performance metrics

---

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **Database**: MongoDB
- **Authentication**: JWT + bcryptjs
- **Payments**: Razorpay
- **SMS**: SMS service provider
- **Email**: Nodemailer

---

**Last Updated**: April 16, 2026  
**Project Status**: Production Ready 