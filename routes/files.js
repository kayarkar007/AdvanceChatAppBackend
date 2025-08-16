const express = require('express')
const asyncHandler = require('express-async-handler')
const multer = require('multer')
const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const { authenticate, fileUploadRateLimiter } = require('../middleware/auth')

const router = express.Router()

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/files')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/csv'
    ]
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('File type not allowed'), false)
    }
  }
})

// @route   POST /api/files/upload
// @desc    Upload file
// @access  Private
router.post('/upload', [
  authenticate,
  fileUploadRateLimiter,
  upload.single('file')
], asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file provided' })
  }

  try {
    const file = req.file
    const fileInfo = {
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: `/uploads/files/${file.filename}`,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    }

    // Generate thumbnail for images
    if (file.mimetype.startsWith('image/')) {
      try {
        const thumbnailName = `thumb_${file.filename}`
        const thumbnailPath = path.join(__dirname, '../uploads/thumbnails', thumbnailName)
        
        // Create thumbnails directory if it doesn't exist
        const thumbnailDir = path.dirname(thumbnailPath)
        if (!fs.existsSync(thumbnailDir)) {
          fs.mkdirSync(thumbnailDir, { recursive: true })
        }

        await sharp(file.path)
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath)

        fileInfo.thumbnail = `/uploads/thumbnails/${thumbnailName}`
      } catch (error) {
        console.error('Error generating thumbnail:', error)
      }
    }

    res.json({
      message: 'File uploaded successfully',
      data: fileInfo
    })
  } catch (error) {
    console.error('Error uploading file:', error)
    res.status(500).json({ message: 'Failed to upload file' })
  }
}))

// @route   GET /api/files/:filename
// @desc    Get file
// @access  Private
router.get('/:filename', authenticate, asyncHandler(async (req, res) => {
  const { filename } = req.params
  const filePath = path.join(__dirname, '../uploads/files', filename)

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' })
  }

  res.sendFile(filePath)
}))

// @route   DELETE /api/files/:filename
// @desc    Delete file
// @access  Private
router.delete('/:filename', authenticate, asyncHandler(async (req, res) => {
  const { filename } = req.params
  const filePath = path.join(__dirname, '../uploads/files', filename)

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' })
  }

  // Check if user owns the file (you might want to store file ownership in database)
  // For now, we'll allow deletion if file exists

  try {
    fs.unlinkSync(filePath)
    
    // Also delete thumbnail if exists
    const thumbnailPath = path.join(__dirname, '../uploads/thumbnails', `thumb_${filename}`)
    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath)
    }

    res.json({ message: 'File deleted successfully' })
  } catch (error) {
    console.error('Error deleting file:', error)
    res.status(500).json({ message: 'Failed to delete file' })
  }
}))

module.exports = router 