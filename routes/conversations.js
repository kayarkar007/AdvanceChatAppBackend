const express = require('express')
const asyncHandler = require('express-async-handler')
const { body, validationResult } = require('express-validator')

const Conversation = require('../models/Conversation')
const Message = require('../models/Message')
const User = require('../models/User')
const { authenticate, authorizeConversationAccess } = require('../middleware/auth')

const router = express.Router()

// @route   GET /api/conversations
// @desc    Get user's conversations
// @access  Private
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const conversations = await Conversation.findForUser(req.user._id)
  
  res.json({
    message: 'Conversations retrieved successfully',
    data: conversations
  })
}))

// @route   GET /api/conversations/:id
// @desc    Get specific conversation
// @access  Private
router.get('/:id', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id)
    .populate('participants.user', 'firstName lastName email avatar status isOnline')
    .populate('lastMessage')
    .populate('pinnedMessages.message')
    .populate('pinnedMessages.pinnedBy', 'firstName lastName')

  res.json({
    message: 'Conversation retrieved successfully',
    data: conversation
  })
}))

// @route   POST /api/conversations
// @desc    Create new conversation
// @access  Private
router.post('/', [
  authenticate,
  body('participants').isArray({ min: 1 }).withMessage('At least one participant is required'),
  body('type').isIn(['direct', 'group']).withMessage('Invalid conversation type'),
  body('name').optional().isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { participants, type, name } = req.body

  // For direct conversations, check if one already exists
  if (type === 'direct' && participants.length === 1) {
    const existingConversation = await Conversation.findDirectConversation(
      req.user._id,
      participants[0]
    )
    
    if (existingConversation) {
      return res.json({
        message: 'Direct conversation already exists',
        data: existingConversation
      })
    }
  }

  // Create conversation
  const conversation = new Conversation({
    type,
    name,
    participants: [
      { user: req.user._id, role: 'admin' },
      ...participants.map(p => ({ user: p, role: 'member' }))
    ]
  })

  await conversation.save()
  await conversation.populate('participants.user', 'firstName lastName email avatar status isOnline')

  res.status(201).json({
    message: 'Conversation created successfully',
    data: conversation
  })
}))

// @route   PUT /api/conversations/:id
// @desc    Update conversation
// @access  Private
router.put('/:id', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const { name, groupSettings } = req.body
  const conversation = req.conversation

  if (name) conversation.name = name
  if (groupSettings) conversation.groupSettings = { ...conversation.groupSettings, ...groupSettings }

  await conversation.save()

  res.json({
    message: 'Conversation updated successfully',
    data: conversation
  })
}))

// @route   DELETE /api/conversations/:id
// @desc    Delete conversation
// @access  Private
router.delete('/:id', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = req.conversation

  // For group conversations, only admin can delete
  if (conversation.type === 'group') {
    const participant = conversation.participants.find(p => p.user.equals(req.user._id))
    if (participant.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can delete group conversations' })
    }
  }

  // Delete all messages in conversation
  await Message.deleteMany({ conversation: conversation._id })

  // Delete conversation
  await conversation.remove()

  res.json({ message: 'Conversation deleted successfully' })
}))

// @route   PUT /api/conversations/:id/read
// @desc    Mark conversation as read
// @access  Private
router.put('/:id/read', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = req.conversation

  // Reset unread count for user
  await conversation.resetUnreadCount(req.user._id)

  // Mark all messages as read
  await Message.updateMany(
    { 
      conversation: conversation._id,
      'readBy.user': { $ne: req.user._id }
    },
    { $push: { readBy: { user: req.user._id, readAt: new Date() } } }
  )

  res.json({ message: 'Conversation marked as read' })
}))

// @route   POST /api/conversations/:id/participants
// @desc    Add participants to conversation
// @access  Private
router.post('/:id/participants', [
  authenticate,
  authorizeConversationAccess,
  body('participants').isArray({ min: 1 }).withMessage('At least one participant is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { participants } = req.body
  const conversation = req.conversation

  // Check if user has permission to add participants
  const userParticipant = conversation.participants.find(p => p.user.equals(req.user._id))
  if (conversation.type === 'group' && userParticipant.role !== 'admin' && userParticipant.role !== 'moderator') {
    return res.status(403).json({ message: 'Insufficient permissions to add participants' })
  }

  // Add participants
  for (const participantId of participants) {
    await conversation.addParticipant(participantId)
  }

  await conversation.populate('participants.user', 'firstName lastName email avatar status isOnline')

  res.json({
    message: 'Participants added successfully',
    data: conversation
  })
}))

// @route   DELETE /api/conversations/:id/participants/:participantId
// @desc    Remove participant from conversation
// @access  Private
router.delete('/:id/participants/:participantId', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = req.conversation
  const { participantId } = req.params

  // Check if user has permission to remove participants
  const userParticipant = conversation.participants.find(p => p.user.equals(req.user._id))
  const targetParticipant = conversation.participants.find(p => p.user.equals(participantId))

  if (!targetParticipant) {
    return res.status(404).json({ message: 'Participant not found' })
  }

  if (conversation.type === 'group') {
    if (userParticipant.role !== 'admin' && userParticipant.role !== 'moderator') {
      return res.status(403).json({ message: 'Insufficient permissions to remove participants' })
    }
    
    if (targetParticipant.role === 'admin') {
      return res.status(403).json({ message: 'Cannot remove admin from conversation' })
    }
  }

  await conversation.removeParticipant(participantId)

  res.json({ message: 'Participant removed successfully' })
}))

// @route   POST /api/conversations/:id/leave
// @desc    Leave conversation
// @access  Private
router.post('/:id/leave', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = req.conversation

  // Check if user is admin in group conversation
  if (conversation.type === 'group') {
    const participant = conversation.participants.find(p => p.user.equals(req.user._id))
    if (participant.role === 'admin' && conversation.participants.filter(p => p.role === 'admin').length === 1) {
      return res.status(400).json({ message: 'Cannot leave group as the only admin. Transfer admin role first.' })
    }
  }

  await conversation.removeParticipant(req.user._id)

  res.json({ message: 'Left conversation successfully' })
}))

// @route   POST /api/conversations/:id/archive
// @desc    Archive conversation
// @access  Private
router.post('/:id/archive', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = req.conversation

  await conversation.archiveConversation(req.user._id)

  res.json({ message: 'Conversation archived successfully' })
}))

// @route   POST /api/conversations/:id/unarchive
// @desc    Unarchive conversation
// @access  Private
router.post('/:id/unarchive', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = req.conversation

  await conversation.unarchiveConversation(req.user._id)

  res.json({ message: 'Conversation unarchived successfully' })
}))

// @route   POST /api/conversations/:id/mute
// @desc    Mute conversation
// @access  Private
router.post('/:id/mute', [
  authenticate,
  authorizeConversationAccess,
  body('duration').optional().isNumeric().withMessage('Duration must be a number')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { duration } = req.body
  const conversation = req.conversation

  await conversation.muteConversation(req.user._id, duration)

  res.json({ message: 'Conversation muted successfully' })
}))

// @route   POST /api/conversations/:id/unmute
// @desc    Unmute conversation
// @access  Private
router.post('/:id/unmute', authenticate, authorizeConversationAccess, asyncHandler(async (req, res) => {
  const conversation = req.conversation

  await conversation.unmuteConversation(req.user._id)

  res.json({ message: 'Conversation unmuted successfully' })
}))

module.exports = router 