const express = require('express')
const asyncHandler = require('express-async-handler')
const { body, validationResult } = require('express-validator')

const Message = require('../models/Message')
const Conversation = require('../models/Conversation')
const { authenticate, authorizeMessageAccess } = require('../middleware/auth')

const router = express.Router()

// @route   GET /api/messages/conversations/:conversationId/messages
// @desc    Get messages for conversation
// @access  Private
router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.user.equals(req.user._id) && p.isActive
    );

    if (!isParticipant) {
      return res
        .status(403)
        .json({ message: "Not a participant of this conversation" });
    }

    const messages = await Message.findForConversation(conversationId, {
      limit: parseInt(limit),
      before: req.query.before ? new Date(req.query.before) : undefined,
    });

    res.json({
      message: "Messages retrieved successfully",
      data: messages,
    });
  })
);

// @route   POST /api/messages/conversations/:conversationId/messages
// @desc    Send message to conversation
// @access  Private
router.post('/conversations/:conversationId/messages', [
  authenticate,
  body('content').notEmpty().withMessage('Message content is required'),
  body('type').optional().isIn(['text', 'image', 'video', 'audio', 'file', 'location', 'contact', 'sticker']),
  body('replyTo').optional().isMongoId().withMessage('Invalid reply message ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { conversationId } = req.params
  const { content, type = 'text', replyTo } = req.body

  // Verify user is participant
  const conversation = await Conversation.findById(conversationId)
  if (!conversation) {
    return res.status(404).json({ message: 'Conversation not found' })
  }

  const isParticipant = conversation.participants.some(p => 
    p.user.equals(req.user._id) && p.isActive
  )
  
  if (!isParticipant) {
    return res.status(403).json({ message: 'Not a participant of this conversation' })
  }

  // Create message
  const message = new Message({
    conversation: conversationId,
    sender: req.user._id,
    type,
    content: type === 'text' ? { text: content } : content,
    replyTo,
    metadata: {
      clientId: req.body.clientId,
      deviceId: req.headers['x-device-id'],
      platform: req.headers['x-platform'],
      version: req.headers['x-version']
    }
  })

  await message.save()
  await message.populate('sender', 'firstName lastName email avatar')
  await message.populate('replyTo')
  
  // Ensure virtuals are included
  message.set('displayContent', message.displayContent)

  // Update conversation last message
  conversation.lastMessage = message._id
  conversation.lastMessageAt = new Date()
  await conversation.save()

  // Update unread count for other participants
  for (const participant of conversation.participants) {
    if (!participant.user.equals(req.user._id) && participant.isActive) {
      await conversation.updateUnreadCount(participant.user)
    }
  }

  res.status(201).json({
    message: 'Message sent successfully',
    data: message
  })
}))

// @route   PUT /api/messages/:id
// @desc    Edit message
// @access  Private
router.put('/:id', [
  authenticate,
  authorizeMessageAccess,
  body('content').notEmpty().withMessage('Message content is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { content } = req.body
  const message = req.message

  // Only sender can edit message
  if (!message.sender.equals(req.user._id)) {
    return res.status(403).json({ message: 'Only message sender can edit message' })
  }

  // Only text messages can be edited
  if (message.type !== 'text') {
    return res.status(400).json({ message: 'Only text messages can be edited' })
  }

  await message.editMessage(content)

  res.json({
    message: 'Message edited successfully',
    data: message
  })
}))

// @route   DELETE /api/messages/:id
// @desc    Delete message
// @access  Private
router.delete('/:id', [
  authenticate,
  authorizeMessageAccess
], asyncHandler(async (req, res) => {
  const message = req.message

  // Only sender or admin can delete message
  const isSender = message.sender.equals(req.user._id)
  const conversation = await Conversation.findById(message.conversation)
  const participant = conversation.participants.find(p => p.user.equals(req.user._id))
  const isAdmin = participant && participant.role === 'admin'

  if (!isSender && !isAdmin) {
    return res.status(403).json({ message: 'Not authorized to delete this message' })
  }

  await message.deleteMessage(req.user._id)

  res.json({ message: 'Message deleted successfully' })
}))

// @route   POST /api/messages/:id/reactions
// @desc    Add reaction to message
// @access  Private
router.post('/:id/reactions', [
  authenticate,
  authorizeMessageAccess,
  body('reaction').notEmpty().withMessage('Reaction is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { reaction } = req.body
  const message = req.message

  await message.addReaction(reaction, req.user._id)

  res.json({
    message: 'Reaction added successfully',
    data: { reaction, count: message.getReactionCount(reaction) }
  })
}))

// @route   DELETE /api/messages/:id/reactions/:reaction
// @desc    Remove reaction from message
// @access  Private
router.delete('/:id/reactions/:reaction', [
  authenticate,
  authorizeMessageAccess
], asyncHandler(async (req, res) => {
  const { reaction } = req.params
  const message = req.message

  await message.removeReaction(reaction, req.user._id)

  res.json({ message: 'Reaction removed successfully' })
}))

// @route   POST /api/messages/:id/forward
// @desc    Forward message to conversations
// @access  Private
router.post('/:id/forward', [
  authenticate,
  authorizeMessageAccess,
  body('conversationIds').isArray({ min: 1 }).withMessage('At least one conversation is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { conversationIds } = req.body
  const originalMessage = req.message

  // Verify user is participant of all target conversations
  const conversations = await Conversation.find({
    _id: { $in: conversationIds },
    'participants.user': req.user._id,
    'participants.isActive': true
  })

  if (conversations.length !== conversationIds.length) {
    return res.status(400).json({ message: 'Some conversations not found or access denied' })
  }

  // Forward message to each conversation
  const forwardedMessages = []
  for (const conversation of conversations) {
    const forwardedMessage = await originalMessage.forwardMessage(conversation._id, req.user._id)
    await forwardedMessage.populate('sender', 'firstName lastName email avatar')
    forwardedMessages.push(forwardedMessage)

    // Update conversation last message
    conversation.lastMessage = forwardedMessage._id
    conversation.lastMessageAt = new Date()
    await conversation.save()
  }

  res.json({
    message: 'Message forwarded successfully',
    data: forwardedMessages
  })
}))

// @route   GET /api/messages/conversations/:conversationId/messages/search
// @desc    Search messages in conversation
// @access  Private
router.get('/conversations/:conversationId/messages/search', authenticate, asyncHandler(async (req, res) => {
  const { conversationId } = req.params
  const { query } = req.query

  if (!query || query.length < 2) {
    return res.status(400).json({ message: 'Search query must be at least 2 characters' })
  }

  // Verify user is participant
  const conversation = await Conversation.findById(conversationId)
  if (!conversation) {
    return res.status(404).json({ message: 'Conversation not found' })
  }

  const isParticipant = conversation.participants.some(p => 
    p.user.equals(req.user._id) && p.isActive
  )
  
  if (!isParticipant) {
    return res.status(403).json({ message: 'Not a participant of this conversation' })
  }

  const messages = await Message.searchMessages(conversationId, query)

  res.json({
    message: 'Search completed successfully',
    data: messages
  })
}))

module.exports = router 