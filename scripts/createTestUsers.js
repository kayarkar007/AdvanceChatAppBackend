const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

// Test users data
const testUsers = [
  {
    firstName: 'Alice',
    lastName: 'Johnson',
    email: 'alice@test.com',
    password: 'Test123!',
    avatar: null,
    status: 'online',
    isEmailVerified: true
  },
  {
    firstName: 'Bob',
    lastName: 'Smith',
    email: 'bob@test.com',
    password: 'Test123!',
    avatar: null,
    status: 'online',
    isEmailVerified: true
  },
  {
    firstName: 'Charlie',
    lastName: 'Brown',
    email: 'charlie@test.com',
    password: 'Test123!',
    avatar: null,
    status: 'away',
    isEmailVerified: true
  },
  {
    firstName: 'Diana',
    lastName: 'Wilson',
    email: 'diana@test.com',
    password: 'Test123!',
    avatar: null,
    status: 'online',
    isEmailVerified: true
  },
  {
    firstName: 'Eve',
    lastName: 'Davis',
    email: 'eve@test.com',
    password: 'Test123!',
    avatar: null,
    status: 'busy',
    isEmailVerified: true
  }
];

async function createTestUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/advancechat');
    console.log('Connected to MongoDB');

    // Clear existing test users
    await User.deleteMany({ email: { $in: testUsers.map(user => user.email) } });
    console.log('Cleared existing test users');

    // Create new test users
    const createdUsers = [];
    for (const userData of testUsers) {
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      
      const user = new User({
        ...userData,
        password: hashedPassword,
        isOnline: userData.status === 'online'
      });

      const savedUser = await user.save();
      createdUsers.push(savedUser);
      console.log(`Created user: ${savedUser.firstName} ${savedUser.lastName} (${savedUser.email})`);
    }

    console.log('\n✅ Test users created successfully!');
    console.log('\n📋 Test User Credentials:');
    console.log('========================');
    
    createdUsers.forEach(user => {
      console.log(`👤 ${user.firstName} ${user.lastName}`);
      console.log(`📧 Email: ${user.email}`);
      console.log(`🔑 Password: Test123!`);
      console.log(`📱 Status: ${user.status}`);
      console.log('---');
    });

    console.log('\n💡 How to test:');
    console.log('1. Open your app in different browser tabs/windows');
    console.log('2. Log in with different test accounts');
    console.log('3. Start conversations between users');
    console.log('4. Test real-time messaging');

  } catch (error) {
    console.error('❌ Error creating test users:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
createTestUsers(); 