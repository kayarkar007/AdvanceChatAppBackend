const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Production database URL (from Render)
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/advancechat";

async function createProductionUsers() {
  try {
    console.log("🔗 Connecting to production database...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to production database");

    // Check if users already exist
    const existingUsers = await User.find({});
    console.log(`📊 Found ${existingUsers.length} existing users`);

    if (existingUsers.length > 0) {
      console.log("ℹ️ Users already exist in production database");
      console.log("👥 Existing users:");
      existingUsers.forEach((user) => {
        console.log(`   - ${user.firstName} ${user.lastName} (${user.email})`);
      });
      return;
    }

    // Create test users
    const testUsers = [
      {
        username: "alice",
        email: "alice@test.com",
        password: "TestPass123!",
        fullName: "Alice Johnson",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=alice",
      },
      {
        username: "bob",
        email: "bob@test.com",
        password: "TestPass123!",
        fullName: "Bob Smith",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob",
      },
      {
        username: "charlie",
        email: "charlie@test.com",
        password: "TestPass123!",
        fullName: "Charlie Brown",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=charlie",
      },
      {
        username: "diana",
        email: "diana@test.com",
        password: "TestPass123!",
        fullName: "Diana Prince",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=diana",
      },
      {
        username: "edward",
        email: "edward@test.com",
        password: "TestPass123!",
        fullName: "Edward Norton",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=edward",
      },
    ];

    console.log("👥 Creating test users...");

    for (const userData of testUsers) {
      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(userData.password, saltRounds);

      // Create user
      const user = new User({
        firstName: userData.fullName.split(" ")[0],
        lastName: userData.fullName.split(" ").slice(1).join(" "),
        email: userData.email,
        password: hashedPassword,
        avatar: userData.avatar,
        isOnline: false,
        lastSeen: new Date(),
      });

      await user.save();
      console.log(`✅ Created user: ${userData.username} (${userData.email})`);
    }

    console.log("🎉 All test users created successfully!");
    console.log("\n📋 Test User Credentials:");
    console.log("========================");
    testUsers.forEach((user) => {
      console.log(`👤 ${user.fullName}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Password: ${user.password}`);
      console.log("---");
    });
  } catch (error) {
    console.error("❌ Error creating production users:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from database");
  }
}

// Run the script
createProductionUsers(); 