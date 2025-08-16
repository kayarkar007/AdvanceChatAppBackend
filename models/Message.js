const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'location', 'contact', 'sticker', 'system'],
    default: 'text'
  },
  content: {
    text: {
      type: String,
      maxlength: [5000, 'Message text cannot exceed 5000 characters']
    },
    media: {
      url: String,
      filename: String,
      size: Number,
      mimeType: String,
      duration: Number, // for audio/video
      thumbnail: String,
      dimensions: {
        width: Number,
        height: Number
      }
    },
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    contact: {
      name: String,
      phone: String,
      email: String
    },
    sticker: {
      id: String,
      url: String
    }
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  forwardedFrom: {
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  reactions: {
    type: Map,
    of: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    default: new Map()
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  deliveredTo: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deliveredAt: {
      type: Date,
      default: Date.now
    }
  }],
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: Date,
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  metadata: {
    clientId: String, // for optimistic updates
    deviceId: String,
    platform: String,
    version: String
  }
}, {
  timestamps: true
})

// Indexes
messageSchema.index({ conversation: 1, createdAt: -1 })
messageSchema.index({ sender: 1 })
messageSchema.index({ type: 1 })

// Virtual for message content
messageSchema.virtual('displayContent').get(function() {
  if (this.isDeleted) return 'This message was deleted'
  
  switch (this.type) {
    case 'text':
      return this.content.text
    case 'image':
      return '📷 Image'
    case 'video':
      return '🎥 Video'
    case 'audio':
      return '🎵 Audio'
    case 'file':
      return '📎 File'
    case 'location':
      return '📍 Location'
    case 'contact':
      return '👤 Contact'
    case 'sticker':
      return '😀 Sticker'
    case 'system':
      return this.content.text
    default:
      return 'Unknown message type'
  }
})

// Method to add reaction
messageSchema.methods.addReaction = function(reaction, userId) {
  if (!this.reactions.has(reaction)) {
    this.reactions.set(reaction, [])
  }
  
  const users = this.reactions.get(reaction)
  if (!users.includes(userId)) {
    users.push(userId)
    this.reactions.set(reaction, users)
  }
  
  return this.save()
}

// Method to remove reaction
messageSchema.methods.removeReaction = function(reaction, userId) {
  if (this.reactions.has(reaction)) {
    const users = this.reactions.get(reaction)
    const filteredUsers = users.filter(id => !id.equals(userId))
    
    if (filteredUsers.length === 0) {
      this.reactions.delete(reaction)
    } else {
      this.reactions.set(reaction, filteredUsers)
    }
  }
  
  return this.save()
}

// Method to mark as read
messageSchema.methods.markAsRead = function(userId) {
  const existingRead = this.readBy.find(r => r.user.equals(userId))
  if (!existingRead) {
    this.readBy.push({
      user: userId,
      readAt: new Date()
    })
  }
  return this.save()
}

// Method to mark as delivered
messageSchema.methods.markAsDelivered = function(userId) {
  const existingDelivery = this.deliveredTo.find(d => d.user.equals(userId))
  if (!existingDelivery) {
    this.deliveredTo.push({
      user: userId,
      deliveredAt: new Date()
    })
  }
  return this.save()
}

// Method to edit message
messageSchema.methods.editMessage = function(newContent) {
  this.content.text = newContent
  this.isEdited = true
  this.editedAt = new Date()
  return this.save()
}

// Method to delete message
messageSchema.methods.deleteMessage = function(userId) {
  this.isDeleted = true
  this.deletedAt = new Date()
  this.deletedBy = userId
  return this.save()
}

// Method to forward message
messageSchema.methods.forwardMessage = function(targetConversationId, userId) {
  const Message = mongoose.model('Message')
  return Message.create({
    conversation: targetConversationId,
    sender: userId,
    type: this.type,
    content: this.content,
    forwardedFrom: {
      message: this._id,
      user: this.sender
    }
  })
}

// Method to get reaction count
messageSchema.methods.getReactionCount = function(reaction) {
  const users = this.reactions.get(reaction) || []
  return users.length
}

// Method to check if user has reacted
messageSchema.methods.hasUserReacted = function(reaction, userId) {
  const users = this.reactions.get(reaction) || []
  return users.some(id => id.equals(userId))
}

// Method to get all reactions summary
messageSchema.methods.getReactionsSummary = function() {
  const summary = {}
  for (const [reaction, users] of this.reactions) {
    summary[reaction] = users.length
  }
  return summary
}

// Static method to find messages for conversation
messageSchema.statics.findForConversation = function(conversationId, options = {}) {
  const query = { conversation: conversationId }
  
  if (options.before) {
    query.createdAt = { $lt: options.before }
  }
  
  if (options.after) {
    query.createdAt = { $gt: options.after }
  }
  
  return this.find(query)
    .populate('sender', 'firstName lastName email avatar')
    .populate('replyTo')
    .populate('forwardedFrom.message')
    .populate('forwardedFrom.user', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(options.limit || 50)
}

// Static method to search messages
messageSchema.statics.searchMessages = function(conversationId, searchQuery) {
  return this.find({
    conversation: conversationId,
    'content.text': { $regex: searchQuery, $options: 'i' },
    isDeleted: false
  })
    .populate('sender', 'firstName lastName email avatar')
    .sort({ createdAt: -1 })
}

module.exports = mongoose.model('Message', messageSchema) 