const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { body, validationResult } = require('express-validator')
const asyncHandler = require('express-async-handler')
const crypto = require('crypto')
const nodemailer = require('nodemailer')

const User = require('../models/User')
const { authenticate, authRateLimiter } = require('../middleware/auth')

const router = express.Router()

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
})

// Generate JWT token
const generateToken = (userId) => {
  console.log('🔍 generateToken called with userId:', userId)
  console.log('🔍 JWT_SECRET available:', !!process.env.JWT_SECRET)
  
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  })
  
  console.log('🔍 Token generated:', token ? `${token.substring(0, 20)}...` : 'Missing')
  return token
}

// Send verification email
const sendVerificationEmail = async (user, token) => {
  const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: 'Verify your email address',
    html: `
      <h1>Welcome to AdvanceChat!</h1>
      <p>Please click the link below to verify your email address:</p>
      <a href="${verificationUrl}">Verify Email</a>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    `
  }
  
  await transporter.sendMail(mailOptions)
}

// Send password reset email
const sendPasswordResetEmail = async (user, token) => {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: 'Reset your password',
    html: `
      <h1>Password Reset Request</h1>
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
    `
  }
  
  await transporter.sendMail(mailOptions)
}

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', [
  authRateLimiter,
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must be at least 8 characters and contain uppercase, lowercase, number and special character')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { firstName, lastName, email, password } = req.body

  // Check if user already exists
  const existingUser = await User.findOne({ email })
  if (existingUser) {
    return res.status(400).json({ message: 'User with this email already exists' })
  }

  // Create verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex')
  const emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000 // 24 hours

  // Create user
  const user = new User({
    firstName,
    lastName,
    email,
    password,
    emailVerificationToken,
    emailVerificationExpires
  })

  await user.save()

  // Send verification email
  try {
    await sendVerificationEmail(user, emailVerificationToken)
  } catch (error) {
    console.error('Failed to send verification email:', error)
  }

  // Generate token
  const token = generateToken(user._id)

  res.status(201).json({
    message: 'User registered successfully. Please check your email to verify your account.',
    data: {
      user: user.getPublicProfile(),
      token
    }
  })
}))

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  authRateLimiter,
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { email, password } = req.body

  // Find user
  const user = await User.findOne({ email })
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' })
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password)
  if (!isPasswordValid) {
    return res.status(401).json({ message: 'Invalid credentials' })
  }

  // Update online status
  await user.updateOnlineStatus(true)

  // Generate token
  const token = generateToken(user._id)
  
  console.log('🔍 Server login - Generated token:', token ? `${token.substring(0, 20)}...` : 'Missing')
  console.log('🔍 Server login - User ID:', user._id)

  const response = {
    message: 'Login successful',
    data: {
      user: user.getPublicProfile(),
      token
    }
  }
  
  console.log('🔍 Server login - Response data:', {
    hasUser: !!response.data.user,
    hasToken: !!response.data.token,
    tokenLength: response.data.token ? response.data.token.length : 0
  })

  res.json(response)
}))

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  // Update online status
  await req.user.updateOnlineStatus(false)

  res.json({ message: 'Logout successful' })
}))

// @route   POST /api/auth/verify-email
// @desc    Verify email address
// @access  Public
router.post('/verify-email', [
  body('token')
    .notEmpty()
    .withMessage('Verification token is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { token } = req.body

  const user = await User.findOne({
    emailVerificationToken: token,
    emailVerificationExpires: { $gt: Date.now() }
  })

  if (!user) {
    return res.status(400).json({ message: 'Invalid or expired verification token' })
  }

  user.isEmailVerified = true
  user.emailVerificationToken = undefined
  user.emailVerificationExpires = undefined
  await user.save()

  res.json({ message: 'Email verified successfully' })
}))

// @route   POST /api/auth/resend-verification
// @desc    Resend verification email
// @access  Public
router.post('/resend-verification', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { email } = req.body

  const user = await User.findOne({ email })
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }

  if (user.isEmailVerified) {
    return res.status(400).json({ message: 'Email is already verified' })
  }

  // Generate new verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex')
  const emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000 // 24 hours

  user.emailVerificationToken = emailVerificationToken
  user.emailVerificationExpires = emailVerificationExpires
  await user.save()

  // Send verification email
  try {
    await sendVerificationEmail(user, emailVerificationToken)
    res.json({ message: 'Verification email sent successfully' })
  } catch (error) {
    console.error('Failed to send verification email:', error)
    res.status(500).json({ message: 'Failed to send verification email' })
  }
}))

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { email } = req.body

  const user = await User.findOne({ email })
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }

  // Generate reset token
  const passwordResetToken = crypto.randomBytes(32).toString('hex')
  const passwordResetExpires = Date.now() + 60 * 60 * 1000 // 1 hour

  user.passwordResetToken = passwordResetToken
  user.passwordResetExpires = passwordResetExpires
  await user.save()

  // Send reset email
  try {
    await sendPasswordResetEmail(user, passwordResetToken)
    res.json({ message: 'Password reset email sent successfully' })
  } catch (error) {
    console.error('Failed to send password reset email:', error)
    res.status(500).json({ message: 'Failed to send password reset email' })
  }
}))

// @route   POST /api/auth/reset-password
// @desc    Reset password
// @access  Public
router.post('/reset-password', [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must be at least 8 characters and contain uppercase, lowercase, number and special character')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed',
      errors: errors.array()
    })
  }

  const { token, password } = req.body

  const user = await User.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: Date.now() }
  })

  if (!user) {
    return res.status(400).json({ message: 'Invalid or expired reset token' })
  }

  // Update password
  user.password = password
  user.passwordResetToken = undefined
  user.passwordResetExpires = undefined
  await user.save()

  res.json({ message: 'Password reset successfully' })
}))

// @route   POST /api/auth/refresh
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh', authenticate, asyncHandler(async (req, res) => {
  const token = generateToken(req.user._id)
  
  res.json({
    message: 'Token refreshed successfully',
    data: {
      user: req.user.getPublicProfile(),
      token
    }
  })
}))

module.exports = router 