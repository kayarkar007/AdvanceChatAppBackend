const express = require('express')
const asyncHandler = require('express-async-handler')
const { body, validationResult } = require('express-validator')
const multer = require('multer')
const sharp = require('sharp')
const path = require('path')

const User = require('../models/User')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

// Configure multer for file uploads
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'), false)
    }
  }
})

// @route   GET /api/users/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', authenticate, asyncHandler(async (req, res) => {
  res.json({
    message: 'Profile retrieved successfully',
    data: req.user.getPublicProfile()
  })
}))

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', [
  authenticate,
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
  body('statusMessage').optional().trim().isLength({ max: 100 }),
  body('preferences').optional().isObject()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { firstName, lastName, statusMessage, preferences } = req.body
  const user = req.user

  if (firstName) user.firstName = firstName
  if (lastName) user.lastName = lastName
  if (statusMessage !== undefined) user.statusMessage = statusMessage
  if (preferences) user.preferences = { ...user.preferences, ...preferences }

  await user.save()

  res.json({
    message: 'Profile updated successfully',
    data: user.getPublicProfile()
  })
}))

// @route   PUT /api/users/avatar
// @desc    Update user avatar
// @access  Private
router.put('/avatar', [
  authenticate,
  upload.single('avatar')
], asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file provided' })
  }

  try {
    // Process image with sharp
    const processedImage = await sharp(req.file.buffer)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer()

    // Generate filename
    const filename = `avatar_${req.user._id}_${Date.now()}.jpg`
    const filepath = path.join(__dirname, '../uploads/avatars', filename)

    // Save file (in production, you'd upload to cloud storage)
    const fs = require('fs')
    const uploadDir = path.dirname(filepath)
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    fs.writeFileSync(filepath, processedImage)

    // Update user avatar
    req.user.avatar = `/uploads/avatars/${filename}`
    await req.user.save()

    res.json({
      message: 'Avatar updated successfully',
      data: { avatar: req.user.avatar }
    })
  } catch (error) {
    console.error('Error processing avatar:', error)
    res.status(500).json({ message: 'Failed to process avatar' })
  }
}))

// @route   GET /api/users/search
// @desc    Search users
// @access  Private
router.get('/search', [
  authenticate,
  body('query').optional().trim().isLength({ min: 1 })
], asyncHandler(async (req, res) => {
  const { query } = req.query
  
  if (!query || query.length < 2) {
    return res.status(400).json({ message: 'Search query must be at least 2 characters' })
  }

  const users = await User.searchUsers(query, req.user._id)

  res.json({
    message: 'Users found successfully',
    data: users
  })
}))

// @route   GET /api/users
// @desc    Get all users (for user search)
// @access  Private
router.get('/', authenticate, asyncHandler(async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('firstName lastName email avatar status isOnline lastSeen')
      .limit(50) // Limit to prevent performance issues

    const userProfiles = users.map(user => ({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
      email: user.email,
      avatar: user.avatar,
      status: user.status,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    }))

    res.json({
      message: 'Users retrieved successfully',
      data: userProfiles
    })
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({
      message: 'Error fetching users',
      data: []
    })
  }
}))

// @route   GET /api/users/online
// @desc    Get online users
// @access  Private
router.get('/online', authenticate, asyncHandler(async (req, res) => {
  const onlineUsers = await User.findOnlineUsers()

  res.json({
    message: 'Online users retrieved successfully',
    data: onlineUsers
  })
}))

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password')
  
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }

  res.json({
    message: 'User retrieved successfully',
    data: user.getPublicProfile()
  })
}))

// @route   PUT /api/users/status
// @desc    Update user status
// @access  Private
router.put('/status', [
  authenticate,
  body('status').isIn(['online', 'offline', 'away', 'busy', 'invisible']),
  body('statusMessage').optional().trim().isLength({ max: 100 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { status, statusMessage } = req.body
  const user = req.user

  user.status = status
  if (statusMessage !== undefined) user.statusMessage = statusMessage

  await user.save()

  res.json({
    message: 'Status updated successfully',
    data: { status: user.status, statusMessage: user.statusMessage }
  })
}))

// @route   POST /api/users/:id/block
// @desc    Block user
// @access  Private
router.post('/:id/block', authenticate, asyncHandler(async (req, res) => {
  const targetUserId = req.params.id

  if (targetUserId === req.user._id.toString()) {
    return res.status(400).json({ message: 'Cannot block yourself' })
  }

  const targetUser = await User.findById(targetUserId)
  if (!targetUser) {
    return res.status(404).json({ message: 'User not found' })
  }

  await req.user.blockUser(targetUserId)

  res.json({ message: 'User blocked successfully' })
}))

// @route   DELETE /api/users/:id/block
// @desc    Unblock user
// @access  Private
router.delete('/:id/block', authenticate, asyncHandler(async (req, res) => {
  const targetUserId = req.params.id

  await req.user.unblockUser(targetUserId)

  res.json({ message: 'User unblocked successfully' })
}))

module.exports = router 