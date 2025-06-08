const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'audiostream-delta.vercel.app';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rooms = new Map();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create-room', (roomId) => {
      socket.join(roomId);
      rooms.set(roomId, {
        host: socket.id,
        participants: new Set([socket.id])
      });
      socket.emit('room-created', roomId);
      console.log(`Room created: ${roomId} by ${socket.id}`);
    });

    socket.on('join-room', (roomId) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      socket.join(roomId);
      room.participants.add(socket.id);
      
      socket.to(room.host).emit('participant-joined', {
        participantId: socket.id,
        totalParticipants: room.participants.size - 1
      });

      socket.to(room.host).emit('request-offer', { participantId: socket.id });
      socket.emit('joined-room', roomId);
    });

    // WebRTC Signaling
    socket.on('offer', ({ offer, participantId }) => {
      socket.to(participantId).emit('offer', { offer, hostId: socket.id });
    });

    socket.on('answer', ({ answer, hostId }) => {
      socket.to(hostId).emit('answer', { answer, participantId: socket.id });
    });

    socket.on('ice-candidate', ({ candidate, targetId }) => {
      socket.to(targetId).emit('ice-candidate', { candidate, senderId: socket.id });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      for (const [roomId, room] of rooms.entries()) {
        if (room.host === socket.id) {
          socket.to(roomId).emit('host-left');
          rooms.delete(roomId);
        } else if (room.participants.has(socket.id)) {
          room.participants.delete(socket.id);
          socket.to(room.host).emit('participant-left', {
            participantId: socket.id,
            totalParticipants: room.participants.size - 1
          });
        }
      }
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
