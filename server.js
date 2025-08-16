const express = require('express')
const http = require('http')
const socketIo = require('socket.io')
const mongoose = require('mongoose')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const userRoutes = require('./routes/users')
const conversationRoutes = require('./routes/conversations')
const messageRoutes = require('./routes/messages')
const fileRoutes = require('./routes/files')
const notificationRoutes = require('./routes/notifications')
const callRoutes = require('./routes/calls')

const { authenticateSocket } = require('./middleware/auth')
const socketHandler = require('./socket/socketHandler')

const app = express()
const server = http.createServer(app)

// Socket.IO setup
const io = socketIo(server, {
  cors: {
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "http://localhost:3000", // Local development
      "http://localhost:5173", // Vite default port
  
      "https://advancechatappfrontend.netlify.app", // Your Netlify domain
      "https://advancechatappfrontend.netlify.app/", // With trailing slash
      "http://192.168.1.0/24",
      "http://10.0.0.0/8",
      "http://172.16.0.0/12",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(morgan("combined"));
app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "http://localhost:3000", // Local development
      "http://localhost:5173", // Vite default port
      "https://advance-chat-app.vercel.app", // Your Vercel domain
      "https://advance-chat-app.vercel.app/", // With trailing slash
      "https://advancechatappfrontend.netlify.app", // Your Netlify domain
      "https://advancechatappfrontend.netlify.app/", // With trailing slash
      "http://192.168.1.0/24", // Allow local network IPs
      "http://10.0.0.0/8", // Allow local network IPs
      "http://172.16.0.0/12", // Allow local network IPs
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
})
app.use('/api/', limiter)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Static files
app.use('/uploads', express.static('uploads'))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/files', fileRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/calls', callRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Socket.IO authentication and event handling
io.use(authenticateSocket)
socketHandler(io)

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  })
})

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/advancechat')
.then(() => {
  console.log('Connected to MongoDB')
})
.catch((err) => {
  console.error('MongoDB connection error:', err)
  process.exit(1)
})

// Redis connection (optional for production)
if (process.env.REDIS_URL) {
  const redis = require('redis')
  const redisClient = redis.createClient({
    url: process.env.REDIS_URL
  })
  
  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err)
  })
  
  redisClient.connect().then(() => {
    console.log('Connected to Redis')
  })
}

const PORT = process.env.PORT || 5000

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`Network access: http://0.0.0.0:${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully')
  server.close(() => {
    console.log('Process terminated')
    mongoose.connection.close()
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully')
  server.close(() => {
    console.log('Process terminated')
    mongoose.connection.close()
    process.exit(0)
  })
})

module.exports = { app, server, io } 