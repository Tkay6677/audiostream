import { Server as NetServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { NextApiResponse } from 'next';

interface SocketServer extends NetServer {
  io?: SocketIOServer;
}

interface SocketWithIO {
  socket: {
    server: SocketServer;
  };
}

const rooms = new Map();

export const GET = async (req: Request, res: NextApiResponse & SocketWithIO) => {
  if (!res.socket?.server) {
    return new Response('Socket server not available', { status: 503 });
  }

  if (!res.socket.server.io) {
    const httpServer: SocketServer = res.socket.server;
    const io = new SocketIOServer(httpServer, {
      path: '/api/socketio',
      addTrailingSlash: false,
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

    res.socket.server.io = io;
  }

  return new Response('Socket.IO server is running', { status: 200 });
}; 