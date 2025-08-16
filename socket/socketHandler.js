const User = require('../models/User')
const Conversation = require('../models/Conversation')
const Message = require('../models/Message')

// Store connected users
const connectedUsers = new Map()

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId}`)
    
    // Add user to connected users
    connectedUsers.set(socket.userId.toString(), {
      socketId: socket.id,
      userId: socket.userId,
      user: socket.user
    })

    // Join user to their personal room
    socket.join(`user:${socket.userId}`)

    // Emit user online event to all connected users
    socket.broadcast.emit('user:online', socket.userId)

    // Handle conversation join
    socket.on('conversation:join', async (data) => {
      try {
        const { conversationId } = data
        
        // Verify user is participant of conversation
        const conversation = await Conversation.findById(conversationId)
        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' })
          return
        }

        const isParticipant = conversation.participants.some(p => 
          p.user.equals(socket.userId) && p.isActive
        )
        
        if (!isParticipant) {
          socket.emit('error', { message: 'Not a participant of this conversation' })
          return
        }

        // Join conversation room
        socket.join(`conversation:${conversationId}`)
        
        // Mark conversation as read
        await conversation.resetUnreadCount(socket.userId)
        
        socket.emit('conversation:joined', { conversationId })
      } catch (error) {
        console.error('Error joining conversation:', error)
        socket.emit('error', { message: 'Failed to join conversation' })
      }
    })

    // Handle conversation leave
    socket.on('conversation:leave', (data) => {
      const { conversationId } = data
      socket.leave(`conversation:${conversationId}`)
      socket.emit('conversation:left', { conversationId })
    })

    // Handle message send
    socket.on('message:send', async (data) => {
      try {
        const { conversationId, message } = data
        
        // Verify user is participant of conversation
        const conversation = await Conversation.findById(conversationId)
        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' })
          return
        }

        const isParticipant = conversation.participants.some(p => 
          p.user.equals(socket.userId) && p.isActive
        )
        
        if (!isParticipant) {
          socket.emit('error', { message: 'Not a participant of this conversation' })
          return
        }

        // Create message
        const newMessage = new Message({
          conversation: conversationId,
          sender: socket.userId,
          type: message.type || 'text',
          content: message.content,
          replyTo: message.replyTo,
          metadata: {
            clientId: message.clientId,
            deviceId: socket.handshake.auth.deviceId,
            platform: socket.handshake.auth.platform,
            version: socket.handshake.auth.version
          }
        })

        await newMessage.save()

        // Populate sender info
        await newMessage.populate('sender', 'firstName lastName email avatar')
        await newMessage.populate('replyTo')

        // Update conversation last message
        conversation.lastMessage = newMessage._id
        conversation.lastMessageAt = new Date()
        await conversation.save()

        // Update unread count for other participants
        for (const participant of conversation.participants) {
          if (!participant.user.equals(socket.userId) && participant.isActive) {
            await conversation.updateUnreadCount(participant.user)
          }
        }

        // Emit message to conversation room
        socket.to(`conversation:${conversationId}`).emit('message:new', newMessage)

        // Emit message to sender for confirmation
        socket.emit('message:sent', {
          clientId: message.clientId,
          message: newMessage
        })

        // Send notifications to offline participants
        for (const participant of conversation.participants) {
          if (!participant.user.equals(socket.userId) && participant.isActive) {
            const participantSocket = connectedUsers.get(participant.user.toString())
            if (!participantSocket) {
              // User is offline, send notification
              io.to(`user:${participant.user}`).emit('notification:new', {
                type: 'message',
                title: `${socket.user.firstName} ${socket.user.lastName}`,
                message: newMessage.displayContent,
                conversationId,
                messageId: newMessage._id
              })
            }
          }
        }

      } catch (error) {
        console.error('Error sending message:', error)
        socket.emit('error', { message: 'Failed to send message' })
      }
    })

    // Handle message reactions
    socket.on('message:react', async (data) => {
      try {
        const { messageId, reaction } = data
        
        const message = await Message.findById(messageId)
        if (!message) {
          socket.emit('error', { message: 'Message not found' })
          return
        }

        // Verify user can access this message
        const conversation = await Conversation.findById(message.conversation)
        const isParticipant = conversation.participants.some(p => 
          p.user.equals(socket.userId) && p.isActive
        )
        
        if (!isParticipant) {
          socket.emit('error', { message: 'Not authorized to react to this message' })
          return
        }

        await message.addReaction(reaction, socket.userId)

        // Emit reaction to conversation room
        socket.to(`conversation:${message.conversation}`).emit('message:reaction', {
          messageId,
          reaction,
          userId: socket.userId
        })

      } catch (error) {
        console.error('Error adding reaction:', error)
        socket.emit('error', { message: 'Failed to add reaction' })
      }
    })

    // Handle reaction removal
    socket.on('message:remove_reaction', async (data) => {
      try {
        const { messageId, reaction } = data
        
        const message = await Message.findById(messageId)
        if (!message) {
          socket.emit('error', { message: 'Message not found' })
          return
        }

        await message.removeReaction(reaction, socket.userId)

        // Emit reaction removal to conversation room
        socket.to(`conversation:${message.conversation}`).emit('message:reaction_removed', {
          messageId,
          reaction,
          userId: socket.userId
        })

      } catch (error) {
        console.error('Error removing reaction:', error)
        socket.emit('error', { message: 'Failed to remove reaction' })
      }
    })

    // Handle typing events
    socket.on('typing:start', async (data) => {
      try {
        const { conversationId } = data
        
        // Verify user is participant
        const conversation = await Conversation.findById(conversationId)
        const isParticipant = conversation.participants.some(p => 
          p.user.equals(socket.userId) && p.isActive
        )
        
        if (!isParticipant) return

        // Emit typing start to conversation room (excluding sender)
        socket.to(`conversation:${conversationId}`).emit('typing:start', {
          userId: socket.userId,
          conversationId
        })

      } catch (error) {
        console.error('Error handling typing start:', error)
      }
    })

    socket.on('typing:stop', async (data) => {
      try {
        const { conversationId } = data
        
        // Verify user is participant
        const conversation = await Conversation.findById(conversationId)
        const isParticipant = conversation.participants.some(p => 
          p.user.equals(socket.userId) && p.isActive
        )
        
        if (!isParticipant) return

        // Emit typing stop to conversation room (excluding sender)
        socket.to(`conversation:${conversationId}`).emit('typing:stop', {
          userId: socket.userId,
          conversationId
        })

      } catch (error) {
        console.error('Error handling typing stop:', error)
      }
    })

    // Handle call events
    socket.on('call:initiate', async (data) => {
      try {
        const { conversationId, type } = data
        
        // Verify user is participant
        const conversation = await Conversation.findById(conversationId)
        const isParticipant = conversation.participants.some(p => 
          p.user.equals(socket.userId) && p.isActive
        )
        
        if (!isParticipant) {
          socket.emit('error', { message: 'Not a participant of this conversation' })
          return
        }

        // Emit call initiation to other participants
        socket.to(`conversation:${conversationId}`).emit('call:incoming', {
          callId: `call_${Date.now()}`,
          conversationId,
          type,
          caller: socket.user
        })

      } catch (error) {
        console.error('Error initiating call:', error)
        socket.emit('error', { message: 'Failed to initiate call' })
      }
    })

    socket.on('call:accept', (data) => {
      const { callId } = data
      socket.broadcast.emit('call:accepted', { callId })
    })

    socket.on('call:reject', (data) => {
      const { callId } = data
      socket.broadcast.emit('call:rejected', { callId })
    })

    socket.on('call:end', (data) => {
      const { callId } = data
      socket.broadcast.emit('call:ended', { callId })
    })

    // Handle message read
    socket.on('message:read', async (data) => {
      try {
        const { messageId } = data
        
        const message = await Message.findById(messageId)
        if (!message) return

        await message.markAsRead(socket.userId)

        // Emit read receipt to conversation room
        socket.to(`conversation:${message.conversation}`).emit('message:read', {
          messageId,
          userId: socket.userId
        })

      } catch (error) {
        console.error('Error marking message as read:', error)
      }
    })

    // Handle message delivery
    socket.on('message:delivered', async (data) => {
      try {
        const { messageId } = data
        
        const message = await Message.findById(messageId)
        if (!message) return

        await message.markAsDelivered(socket.userId)

        // Emit delivery receipt to conversation room
        socket.to(`conversation:${message.conversation}`).emit('message:delivered', {
          messageId,
          userId: socket.userId
        })

      } catch (error) {
        console.error('Error marking message as delivered:', error)
      }
    })

    // Handle user status update
    socket.on('user:status_update', async (data) => {
      try {
        const { status, statusMessage } = data
        
        await User.findByIdAndUpdate(socket.userId, {
          status,
          statusMessage
        })

        // Emit status update to all connected users
        socket.broadcast.emit('user:status_updated', {
          userId: socket.userId,
          status,
          statusMessage
        })

      } catch (error) {
        console.error('Error updating user status:', error)
        socket.emit('error', { message: 'Failed to update status' })
      }
    })

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.userId}`)
      
      // Remove user from connected users
      connectedUsers.delete(socket.userId.toString())

      // Update user's online status
      try {
        await User.findByIdAndUpdate(socket.userId, {
          isOnline: false,
          lastSeen: new Date()
        })

        // Emit user offline event
        socket.broadcast.emit('user:offline', socket.userId)
      } catch (error) {
        console.error('Error updating user offline status:', error)
      }
    })
  })

  // Handle server-wide events
  io.on('error', (error) => {
    console.error('Socket.IO error:', error)
  })
}

module.exports = socketHandler 