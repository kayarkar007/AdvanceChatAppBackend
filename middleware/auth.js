const jwt = require('jsonwebtoken')
const User = require('../models/User')

// HTTP Authentication middleware
const authenticate = async (req, res, next) => {
    console.log('🔍 Auth middleware called for:', req.method, req.originalUrl)
    console.log('🔍 Authorization header:', req.headers.authorization ? 'Present' : 'Missing')
    
    try {
      // 1️⃣ Check if token exists
      if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
        console.log('❌ No Bearer token found')
        return res.status(401).json({ message: 'No token, authorization denied' })
      }
  
      // 2️⃣ Extract token
      const token = req.headers.authorization.split(' ')[1]
      console.log('🔍 Token extracted:', token ? `${token.substring(0, 20)}...` : 'Missing')
  
      // 3️⃣ Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      console.log('🔍 Token decoded successfully, userId:', decoded.userId)
  
      // 4️⃣ Find user in DB
      const user = await User.findById(decoded.userId).select('-password')
      if (!user) {
        console.log('❌ User not found for ID:', decoded.userId)
        return res.status(401).json({ message: 'User not found' })
      }
  
      // 5️⃣ Attach user to request
      req.user = user
      console.log('✅ User authenticated:', user.email)
  
      next()
  
    } catch (error) {
      console.error("❌ Authentication error:", error.message)
      return res.status(401).json({ message: 'Token is not valid' })
    }
  }

// Socket.IO Authentication middleware
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'))
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.userId).select('-password')
    
    if (!user) {
      return next(new Error('Authentication error: User not found'))
    }

    socket.user = user
    socket.userId = user._id
    
    // Update user's online status
    await user.updateOnlineStatus(true)
    
    next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new Error('Authentication error: Invalid token'))
    }
    if (error.name === 'TokenExpiredError') {
      return next(new Error('Authentication error: Token expired'))
    }
    next(new Error('Authentication error: Server error'))
  }
}

// Optional authentication middleware (for public routes)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '')
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.userId).select('-password')
      if (user) {
        req.user = user
      }
    }
    
    next()
  } catch (error) {
    // Continue without authentication
    next()
  }
}

// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Access denied. Authentication required.' })
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' })
    }
    
    next()
  }
}

// Conversation access middleware
const authorizeConversationAccess = async (req, res, next) => {
  try {
    const conversationId = req.params.conversationId || req.body.conversationId
    const userId = req.user._id

    const Conversation = require('../models/Conversation')
    const conversation = await Conversation.findById(conversationId)
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found.' })
    }

    const isParticipant = conversation.participants.some(p => 
      p.user.equals(userId) && p.isActive
    )
    
    if (!isParticipant) {
      return res.status(403).json({ message: 'Access denied. Not a participant of this conversation.' })
    }

    req.conversation = conversation
    next()
  } catch (error) {
    res.status(500).json({ message: 'Server error.' })
  }
}

// Message access middleware
const authorizeMessageAccess = async (req, res, next) => {
  try {
    const messageId = req.params.messageId || req.body.messageId
    const userId = req.user._id

    const Message = require('../models/Message')
    const message = await Message.findById(messageId)
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found.' })
    }

    // Check if user is sender or conversation participant
    const isSender = message.sender.equals(userId)
    
    if (!isSender) {
      const Conversation = require('../models/Conversation')
      const conversation = await Conversation.findById(message.conversation)
      
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found.' })
      }

      const isParticipant = conversation.participants.some(p => 
        p.user.equals(userId) && p.isActive
      )
      
      if (!isParticipant) {
        return res.status(403).json({ message: 'Access denied. Not authorized to access this message.' })
      }
    }

    req.message = message
    next()
  } catch (error) {
    res.status(500).json({ message: 'Server error.' })
  }
}

// Rate limiting middleware
const rateLimit = require('express-rate-limit')

const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { message },
    standardHeaders: true,
    legacyHeaders: false,
  })
}

// Specific rate limiters
const authRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts
  'Too many authentication attempts. Please try again later.'
)

const messageRateLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  30, // 30 messages
  'Too many messages. Please slow down.'
)

const fileUploadRateLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  10, // 10 uploads
  'Too many file uploads. Please try again later.'
)

module.exports = {
  authenticate,
  authenticateSocket,
  optionalAuth,
  authorize,
  authorizeConversationAccess,
  authorizeMessageAccess,
  authRateLimiter,
  messageRateLimiter,
  fileUploadRateLimiter
} 