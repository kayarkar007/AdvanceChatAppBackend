const express = require('express')
const asyncHandler = require('express-async-handler')

const { authenticate } = require('../middleware/auth')

const router = express.Router()

// @route   GET /api/notifications
// @desc    Get user notifications
// @access  Private
router.get('/', authenticate, asyncHandler(async (req, res) => {
  // This would typically fetch notifications from a database
  // For now, we'll return a mock response
  const notifications = [
    {
      id: '1',
      type: 'message',
      title: 'New message from John Doe',
      message: 'Hey, how are you?',
      read: false,
      createdAt: new Date()
    }
  ]

  res.json({
    message: 'Notifications retrieved successfully',
    data: notifications
  })
}))

// @route   PUT /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params

  // This would typically update the notification in database
  // For now, we'll return a success response

  res.json({ message: 'Notification marked as read' })
}))

// @route   PUT /api/notifications/read-all
// @desc    Mark all notifications as read
// @access  Private
router.put('/read-all', authenticate, asyncHandler(async (req, res) => {
  // This would typically update all notifications in database
  // For now, we'll return a success response

  res.json({ message: 'All notifications marked as read' })
}))

// @route   DELETE /api/notifications/:id
// @desc    Delete notification
// @access  Private
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params

  // This would typically delete the notification from database
  // For now, we'll return a success response

  res.json({ message: 'Notification deleted successfully' })
}))

// @route   PUT /api/notifications/settings
// @desc    Update notification settings
// @access  Private
router.put('/settings', authenticate, asyncHandler(async (req, res) => {
  const { email, push, sound } = req.body

  // Update user's notification preferences
  req.user.preferences.notifications.email = email
  req.user.preferences.notifications.push = push
  req.user.preferences.notifications.sound = sound

  await req.user.save()

  res.json({
    message: 'Notification settings updated successfully',
    data: req.user.preferences.notifications
  })
}))

module.exports = router 