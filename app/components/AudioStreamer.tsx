'use client';

import { useState, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export default function AudioStreamer() {
  const [isHost, setIsHost] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [participants, setParticipants] = useState(0);
  const [error, setError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const socketRef = useRef<Socket | null>(null);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  useEffect(() => {
    socketRef.current = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://audiostream-delta.vercel.app', {
      transports: ['websocket'],
      path: '/api/socketio'
    });
    
    socketRef.current.on('connect', () => {
      setConnectionStatus('connected');
    });

    socketRef.current.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('room-created', (roomId) => {
      setRoomId(roomId);
      setIsStreaming(true);
    });

    socketRef.current.on('joined-room', () => {
      setIsListening(true);
    });

    socketRef.current.on('participant-joined', ({ totalParticipants }) => {
      setParticipants(totalParticipants);
    });

    socketRef.current.on('participant-left', ({ totalParticipants }) => {
      setParticipants(totalParticipants);
    });

    socketRef.current.on('request-offer', async ({ participantId }) => {
      await createPeerConnection(participantId, true);
    });

    socketRef.current.on('offer', async ({ offer, hostId }) => {
      await handleOffer(offer, hostId);
    });

    socketRef.current.on('answer', async ({ answer, participantId }) => {
      await handleAnswer(answer, participantId);
    });

    socketRef.current.on('ice-candidate', async ({ candidate, senderId }) => {
      await handleIceCandidate(candidate, senderId);
    });

    socketRef.current.on('host-left', () => {
      setError('Host has left the room');
      leaveRoom();
    });

    socketRef.current.on('error', ({ message }) => {
      setError(message);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const createPeerConnection = async (peerId: string, isInitiator: boolean) => {
    try {
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionsRef.current[peerId] = peerConnection;

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current!.emit('ice-candidate', {
            candidate: event.candidate,
            targetId: peerId
          });
        }
      };

      if (isHost && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStreamRef.current!);
        });
      }

      if (!isHost) {
        peerConnection.ontrack = (event) => {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = event.streams[0];
          }
        };
      }

      if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socketRef.current!.emit('offer', { offer, participantId: peerId });
      }

    } catch (error) {
      console.error('Error creating peer connection:', error);
      setError('Failed to establish connection');
    }
  };

  const handleOffer = async (offer: RTCSessionDescription, hostId: string) => {
    try {
      await createPeerConnection(hostId, false);
      const peerConnection = peerConnectionsRef.current[hostId];
      
      await peerConnection.setRemoteDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socketRef.current!.emit('answer', { answer, hostId });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescription, participantId: string) => {
    try {
      const peerConnection = peerConnectionsRef.current[participantId];
      await peerConnection.setRemoteDescription(answer);
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidate, senderId: string) => {
    try {
      const peerConnection = peerConnectionsRef.current[senderId];
      await peerConnection.addIceCandidate(candidate);
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const startHosting = async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      localStreamRef.current = stream;
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }
      
      const newRoomId = generateRoomId();
      setIsHost(true);
      socketRef.current!.emit('create-room', newRoomId);
      
    } catch (err) {
      setError('Failed to access microphone. Please check permissions.');
    }
  };

  const stopHosting = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null;
    }
    
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    
    setIsStreaming(false);
    setIsHost(false);
    setRoomId('');
    setParticipants(0);
  };

  const joinRoom = async () => {
    if (!joinRoomId.trim()) {
      setError('Please enter a room ID');
      return;
    }
    
    try {
      setError('');
      socketRef.current!.emit('join-room', joinRoomId.toUpperCase());
    } catch (err) {
      setError('Failed to join room');
    }
  };

  const leaveRoom = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    
    setIsListening(false);
    setJoinRoomId('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4 bg-gradient-to-r from-pink-400 to-purple-600 bg-clip-text text-transparent">
            🎵 Audio Stream
          </h1>
          <p className="text-xl text-gray-300">
            Share your audio with the world in real-time
          </p>
          <div className={`inline-block mt-4 px-3 py-1 rounded-full text-sm ${
            connectionStatus === 'connected' 
              ? 'bg-green-500/20 text-green-300 border border-green-500' 
              : 'bg-red-500/20 text-red-300 border border-red-500'
          }`}>
            {connectionStatus === 'connected' ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 mb-6 text-red-200 text-center max-w-2xl mx-auto">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Host Section */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-2xl">
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center">
              🎤 Host Stream
            </h2>
            
            {!isStreaming ? (
              <>
                <p className="text-gray-300 mb-6">
                  Start streaming your audio to multiple listeners
                </p>
                <button
                  onClick={startHosting}
                  disabled={connectionStatus !== 'connected'}
                  className="w-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg"
                >
                  🎙️ Start Streaming
                </button>
              </>
            ) : (
              <div className="space-y-6">
                <div className="bg-green-500/20 border border-green-500 rounded-lg p-4">
                  <p className="text-green-200 font-semibold">
                    🔴 LIVE - Room ID: <span className="font-mono text-xl">{roomId}</span>
                  </p>
                  <p className="text-green-300 text-sm mt-2">
                    👥 {participants} listeners connected
                  </p>
                </div>
                
                <div className="bg-black/30 rounded-lg p-4">
                  <audio
                    ref={localAudioRef}
                    controls
                    muted
                    className="w-full"
                  />
                  <p className="text-gray-400 text-sm mt-2">
                    Preview (muted for you)
                  </p>
                </div>
                
                <button
                  onClick={stopHosting}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300"
                >
                  ⏹️ Stop Stream
                </button>
              </div>
            )}
          </div>

          {/* Listener Section */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-2xl">
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center">
              🎧 Join Stream
            </h2>
            
            {!isListening ? (
              <>
                <p className="text-gray-300 mb-6">
                  Enter a room ID to listen to a live stream
                </p>
                <div className="space-y-4">
                  <input
                    type="text"
                    placeholder="Enter Room ID (e.g., ABC123)"
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                    className="w-full bg-white/20 border border-white/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    maxLength={6}
                  />
                  <button
                    onClick={joinRoom}
                    disabled={!joinRoomId.trim() || connectionStatus !== 'connected'}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg"
                  >
                    🎵 Join Stream
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-6">
                <div className="bg-blue-500/20 border border-blue-500 rounded-lg p-4">
                  <p className="text-blue-200 font-semibold">
                    🎧 Connected to Room: <span className="font-mono">{joinRoomId}</span>
                  </p>
                  <p className="text-blue-300 text-sm mt-2">
                    Listening to live audio stream
                  </p>
                </div>
                
                <div className="bg-black/30 rounded-lg p-4">
                  <audio
                    ref={remoteAudioRef}
                    controls
                    autoPlay
                    className="w-full"
                  />
                  <p className="text-gray-400 text-sm mt-2">
                    Live audio stream
                  </p>
                </div>
                
                <button
                  onClick={leaveRoom}
                  className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300"
                >
                  👋 Leave Stream
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="max-w-2xl mx-auto mt-12 bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
          <h3 className="text-xl font-bold text-white mb-4">📋 How it works:</h3>
          <div className="space-y-2 text-gray-300">
            <p><strong>For Hosts:</strong> Click "Start Streaming" to generate a room ID and begin broadcasting your audio</p>
            <p><strong>For Listeners:</strong> Enter the host's room ID and click "Join Stream" to listen</p>
            <p><strong>Real-time:</strong> Uses WebRTC for peer-to-peer audio streaming with low latency</p>
          </div>
        </div>
      </div>
    </div>
  );
}
