const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long']
  },
  avatar: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away', 'busy', 'invisible'],
    default: 'offline'
  },
  statusMessage: {
    type: String,
    maxlength: [100, 'Status message cannot exceed 100 characters'],
    default: ''
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  blockedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'light'
    },
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sound: { type: Boolean, default: true }
    },
    privacy: {
      showOnlineStatus: { type: Boolean, default: true },
      showLastSeen: { type: Boolean, default: true },
      allowMessagesFrom: { type: String, enum: ['everyone', 'contacts', 'none'], default: 'everyone' }
    }
  },
  contacts: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    nickname: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  deviceTokens: [{
    token: String,
    device: String,
    platform: String,
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
})

// Indexes
userSchema.index({ email: 1 })
userSchema.index({ isOnline: 1 })
userSchema.index({ lastSeen: 1 })

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`
})

// Virtual for initials
userSchema.virtual('initials').get(function() {
  return `${this.firstName.charAt(0)}${this.lastName.charAt(0)}`.toUpperCase()
})

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()
  
  try {
    const salt = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error) {
    next(error)
  }
})

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password)
}

// Method to get public profile
userSchema.methods.getPublicProfile = function() {
  return {
    _id: this._id,
    firstName: this.firstName,
    lastName: this.lastName,
    fullName: `${this.firstName} ${this.lastName}`,
    initials: this.initials,
    email: this.email,
    avatar: this.avatar,
    status: this.status,
    statusMessage: this.statusMessage,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
    preferences: this.preferences,
  };
}

// Method to update online status
userSchema.methods.updateOnlineStatus = function(isOnline) {
  this.isOnline = isOnline
  this.lastSeen = new Date()
  if (!isOnline) {
    this.status = 'offline'
  }
  return this.save()
}

// Method to block user
userSchema.methods.blockUser = function(userId) {
  if (!this.blockedUsers.includes(userId)) {
    this.blockedUsers.push(userId)
  }
  return this.save()
}

// Method to unblock user
userSchema.methods.unblockUser = function(userId) {
  this.blockedUsers = this.blockedUsers.filter(id => !id.equals(userId))
  return this.save()
}

// Method to check if user is blocked
userSchema.methods.isBlocked = function(userId) {
  return this.blockedUsers.some(id => id.equals(userId))
}

// Method to check if user is blocked by another user
userSchema.methods.isBlockedBy = function(userId) {
  return this.blockedBy.some(id => id.equals(userId))
}

// Static method to find online users
userSchema.statics.findOnlineUsers = function() {
  return this.find({ isOnline: true }).select('_id firstName lastName avatar status statusMessage')
}

// Static method to search users
userSchema.statics.searchUsers = function(query, excludeUserId) {
  const searchRegex = new RegExp(query, 'i')
  return this.find({
    $and: [
      {
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex }
        ]
      },
      { _id: { $ne: excludeUserId } }
    ]
  }).select('_id firstName lastName email avatar status isOnline')
}

module.exports = mongoose.model('User', userSchema) 