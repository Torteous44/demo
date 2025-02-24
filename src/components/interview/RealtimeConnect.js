import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AudioVisualizer from './AudioVisualizer';
import '../../styles/RealtimeConnect.css';

function RealtimeConnect() {
  const { sessionId: urlSessionId } = useParams();
  // eslint-disable-next-line no-unused-vars
  const [sessionId, setSessionId] = useState(urlSessionId || "");
  const [log, setLog] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timer, setTimer] = useState(0);
  const [mediaStream, setMediaStream] = useState(null);
  const [interviewTitle, setInterviewTitle] = useState("Interview Session");
  const audioRef = useRef(null);
  // eslint-disable-next-line no-unused-vars
  const timerRef = useRef(null);
  const peerConnection = useRef(null);
  const navigate = useNavigate();
  const [volume, setVolume] = useState(1);

  const appendLog = useCallback((msg) => {
    console.log("Log:", msg);
    setLog((prev) => prev + "\n" + msg);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleConnect = useCallback(async () => {
    if (!sessionId) {
      appendLog("No session ID provided");
      return alert("Need a session ID.");
    }

    appendLog("Starting connection process...");
    const token = localStorage.getItem("token");
    if (!token) {
      appendLog("Not logged in");
      return alert("You must be logged in first.");
    }

    try {
      // Stop any existing streams
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      if (audioRef.current) {
        audioRef.current.srcObject = null;
      }

      setIsConnected(true);
      
      // 1) Get ephemeral token
      appendLog("Fetching ephemeral token...");
      const rtResp = await fetch(`https://demobackend-p2e1.onrender.com/realtime/token?session_id=${sessionId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!rtResp.ok) throw new Error("Failed to get ephemeral token");
      const rtData = await rtResp.json();
      const ephemeralKey = rtData.client_secret.value;
      appendLog("Got ephemeral key: " + ephemeralKey.substring(0, 15) + "...");
      
      // 2) Create RTCPeerConnection
      appendLog("Creating RTCPeerConnection...");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      
      pc.onconnectionstatechange = () => {
        appendLog(`Connection state changed: ${pc.connectionState}`);
      };
      
      pc.oniceconnectionstatechange = () => {
        appendLog(`ICE connection state: ${pc.iceConnectionState}`);
      };
      
      pc.onicegatheringstatechange = () => {
        appendLog(`ICE gathering state: ${pc.iceGatheringState}`);
      };
      
      pc.onsignalingstatechange = () => {
        appendLog(`Signaling state: ${pc.signalingState}`);
      };

      // 3) Add audio track
      appendLog("Adding user audio track...");
      const newStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      newStream.getTracks().forEach(track => {
        track.enabled = !isMuted;
        pc.addTrack(track, newStream);
      });
      
      // 4) Handle incoming audio
      pc.ontrack = (evt) => {
        appendLog("🎵 Track received: " + evt.track.kind);
        if (evt.track.kind === "audio") {
          appendLog("Setting up audio playback...");
          try {
            const stream = evt.streams[0];
            appendLog(`Stream ID: ${stream.id}`);
            appendLog(`Stream active: ${stream.active}`);
            appendLog(`Audio tracks: ${stream.getAudioTracks().length}`);
            
            if (audioRef.current) {
              // Reset audio element
              audioRef.current.srcObject = null;
              audioRef.current.load();
              
              // Configure audio element
              audioRef.current.srcObject = stream;
              audioRef.current.volume = volume;
              audioRef.current.muted = false;
              
              // Play audio
              const playPromise = audioRef.current.play();
              if (playPromise !== undefined) {
                playPromise
                  .then(() => {
                    appendLog("Playback started successfully");
                    // Double-check volume and muted state
                    audioRef.current.volume = volume;
                    audioRef.current.muted = false;
                  })
                  .catch(err => {
                    appendLog(`Play failed: ${err.message}`);
                    // Try to recover
                    setTimeout(() => {
                      audioRef.current.play().catch(console.error);
                    }, 1000);
                  });
              }
            }
            setMediaStream(stream);
          } catch (err) {
            appendLog(`Audio setup error: ${err.message}`);
            console.error('Audio setup error:', err);
          }
        }
      };

      // 5) Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      appendLog("Local SDP offer created.");
      
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResp = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });
      if (!sdpResp.ok) throw new Error("OpenAI Realtime handshake failed");
      const answerSDP = await sdpResp.text();
      appendLog("Received SDP answer from OpenAI.");
      
      await pc.setRemoteDescription({ type: "answer", sdp: answerSDP });
      appendLog("Remote SDP set.");
      
      peerConnection.current = pc;
      appendLog("Setup complete - waiting for audio...");
      
    } catch (err) {
      appendLog(`Connection error: ${err.message}`);
      console.error("Connection error:", err);
      setIsConnected(false);
    }
  }, [sessionId, isMuted, volume, appendLog, mediaStream]);

  useEffect(() => {
    if (urlSessionId) {
      handleConnect();
    }
  }, [urlSessionId, handleConnect]);

  useEffect(() => {
    let interval;
    if (isConnected) {
      interval = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  // Fetch interview title
  useEffect(() => {
    const fetchInterviewDetails = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`https://demobackend-p2e1.onrender.com/sessions/${sessionId}/details`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          }
        });
        const data = await response.json();
        setInterviewTitle(data.interview_name || "Interview Session");
      } catch (err) {
        console.error('Error fetching interview details:', err);
      }
    };

    if (sessionId) {
      fetchInterviewDetails();
    }
  }, [sessionId]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = async () => {
    try {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      setIsConnected(false);
      navigate('/dashboard');
    } catch (err) {
      appendLog(`End call error: ${err.message}`);
    }
  };

  const handleMuteToggle = () => {
    if (mediaStream) {
      const audioTracks = mediaStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
      appendLog(`Microphone ${isMuted ? 'unmuted' : 'muted'}`);
    }
  };

  const handlePauseToggle = () => {
    setIsPaused(!isPaused);
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => {
        track.enabled = !isPaused;
      });
      appendLog(isPaused ? "Resumed" : "Paused");
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  return (
    <div className="realtime-connect-container">
      <div className="interview-header">
        <h1>{interviewTitle}</h1>
      </div>

      <div className="interview-interface">
        <div className="visualizer-container">
          <AudioVisualizer mediaStream={mediaStream} />
          <div className="timer">{formatTime(timer)}</div>
        </div>
        
        <div className="controls">
          <button
            className={`control-button ${isMuted ? 'active' : ''}`}
            onClick={handleMuteToggle}
            title={isMuted ? "Unmute" : "Mute"}
          >
            <img src="/assets/mute.svg" alt="Mute" className="control-icon" />
          </button>

          <button
            className="control-button end-call"
            onClick={handleEndCall}
            title="End Call"
          >
            <img src="/assets/call.svg" alt="End Call" className="control-icon" />
          </button>

          <button
            className={`control-button ${isPaused ? 'active' : ''}`}
            onClick={handlePauseToggle}
            title={isPaused ? "Resume" : "Pause"}
          >
            <img src="/assets/pause.svg" alt="Pause" className="control-icon" />
          </button>

          <div className="volume-control">
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={handleVolumeChange}
              style={{ width: '100px' }}
            />
          </div>
        </div>
      </div>
      
      <audio 
        ref={audioRef}
        id="aiAudio" 
        autoPlay
        playsInline
        preload="auto"
        style={{ display: 'block', width: '100%' }}
        controls
      />
      
      <pre className="debug-log">{log}</pre>
    </div>
  );
}

export default RealtimeConnect;
