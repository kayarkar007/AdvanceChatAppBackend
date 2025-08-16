const mongoose = require('mongoose')

const conversationSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    maxlength: [100, 'Conversation name cannot exceed 100 characters']
  },
  type: {
    type: String,
    enum: ['direct', 'group'],
    default: 'direct'
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'moderator', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: Date,
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  groupSettings: {
    description: {
      type: String,
      maxlength: [500, 'Group description cannot exceed 500 characters']
    },
    avatar: String,
    rules: [String],
    inviteLink: String,
    isPrivate: {
      type: Boolean,
      default: false
    },
    allowMemberInvite: {
      type: Boolean,
      default: true
    }
  },
  pinnedMessages: [{
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    pinnedAt: {
      type: Date,
      default: Date.now
    }
  }],
  archivedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    archivedAt: {
      type: Date,
      default: Date.now
    }
  }],
  mutedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    mutedUntil: Date,
    mutedAt: {
      type: Date,
      default: Date.now
    }
  }],
  deletedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deletedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
})

// Indexes
conversationSchema.index({ participants: 1 })
conversationSchema.index({ lastMessageAt: -1 })
conversationSchema.index({ type: 1 })

// Virtual for conversation name
conversationSchema.virtual('displayName').get(function() {
  if (this.name) return this.name
  if (this.type === 'direct' && this.participants.length === 2) {
    const otherParticipant = this.participants.find(p => p.user && p.user._id)
    return otherParticipant ? otherParticipant.user.fullName : 'Unknown User'
  }
  return 'Group Chat'
})

// Method to add participant
conversationSchema.methods.addParticipant = function(userId, role = 'member') {
  const existingParticipant = this.participants.find(p => p.user.equals(userId))
  if (!existingParticipant) {
    this.participants.push({
      user: userId,
      role,
      joinedAt: new Date(),
      isActive: true
    })
  }
  return this.save()
}

// Method to remove participant
conversationSchema.methods.removeParticipant = function(userId) {
  const participant = this.participants.find(p => p.user.equals(userId))
  if (participant) {
    participant.isActive = false
    participant.leftAt = new Date()
  }
  return this.save()
}

// Method to update unread count
conversationSchema.methods.updateUnreadCount = function(userId, count = 1) {
  const currentCount = this.unreadCount.get(userId.toString()) || 0
  this.unreadCount.set(userId.toString(), currentCount + count)
  return this.save()
}

// Method to reset unread count
conversationSchema.methods.resetUnreadCount = function(userId) {
  this.unreadCount.set(userId.toString(), 0)
  return this.save()
}

// Method to archive conversation
conversationSchema.methods.archiveConversation = function(userId) {
  const existingArchive = this.archivedBy.find(a => a.user.equals(userId))
  if (!existingArchive) {
    this.archivedBy.push({ user: userId })
  }
  return this.save()
}

// Method to unarchive conversation
conversationSchema.methods.unarchiveConversation = function(userId) {
  this.archivedBy = this.archivedBy.filter(a => !a.user.equals(userId))
  return this.save()
}

// Method to mute conversation
conversationSchema.methods.muteConversation = function(userId, duration = null) {
  const mutedUntil = duration ? new Date(Date.now() + duration) : null
  const existingMute = this.mutedBy.find(m => m.user.equals(userId))
  
  if (existingMute) {
    existingMute.mutedUntil = mutedUntil
    existingMute.mutedAt = new Date()
  } else {
    this.mutedBy.push({
      user: userId,
      mutedUntil,
      mutedAt: new Date()
    })
  }
  return this.save()
}

// Method to unmute conversation
conversationSchema.methods.unmuteConversation = function(userId) {
  this.mutedBy = this.mutedBy.filter(m => !m.user.equals(userId))
  return this.save()
}

// Method to check if user is muted
conversationSchema.methods.isUserMuted = function(userId) {
  const mute = this.mutedBy.find(m => m.user.equals(userId))
  if (!mute) return false
  
  if (mute.mutedUntil && mute.mutedUntil > new Date()) {
    return true
  }
  
  // Remove expired mute
  this.mutedBy = this.mutedBy.filter(m => !m.user.equals(userId))
  return false
}

// Method to pin message
conversationSchema.methods.pinMessage = function(messageId, userId) {
  const existingPin = this.pinnedMessages.find(p => p.message.equals(messageId))
  if (!existingPin) {
    this.pinnedMessages.push({
      message: messageId,
      pinnedBy: userId,
      pinnedAt: new Date()
    })
  }
  return this.save()
}

// Method to unpin message
conversationSchema.methods.unpinMessage = function(messageId) {
  this.pinnedMessages = this.pinnedMessages.filter(p => !p.message.equals(messageId))
  return this.save()
}

// Method to delete conversation for user
conversationSchema.methods.deleteForUser = function(userId) {
  const existingDelete = this.deletedBy.find(d => d.user.equals(userId))
  if (!existingDelete) {
    this.deletedBy.push({ user: userId })
  }
  return this.save()
}

// Static method to find conversations for user
conversationSchema.statics.findForUser = function(userId, options = {}) {
  const query = {
    'participants.user': userId,
    'participants.isActive': true,
    'deletedBy.user': { $ne: userId }
  }
  
  if (options.type) {
    query.type = options.type
  }
  
  return this.find(query)
    .populate('participants.user', 'firstName lastName email avatar status isOnline')
    .populate('lastMessage')
    .sort({ lastMessageAt: -1 })
}

// Static method to find direct conversation between two users
conversationSchema.statics.findDirectConversation = function(userId1, userId2) {
  return this.findOne({
    type: 'direct',
    'participants.user': { $all: [userId1, userId2] },
    'participants.isActive': true
  }).populate('participants.user', 'firstName lastName email avatar status isOnline')
}

module.exports = mongoose.model('Conversation', conversationSchema) 